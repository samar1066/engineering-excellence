import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Repository } from "aws-cdk-lib/aws-ecr";
import { DockerImageCode, DockerImageFunction, Tracing } from "aws-cdk-lib/aws-lambda";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import type { Environment } from "./environments.js";

/**
 * The container image repository this API Lambda runs. It is a placeholder: replace it with the real
 * ECR repository the delivery pipeline pushes to, for example `{{project_name}}-api`, the first time
 * this stack is deployed against a real account. The tag beside it is never edited here, see
 * IMAGE_TAG_CONTEXT_KEY.
 *
 * The compute is a container image Lambda: the image the pipeline built from the backend's Dockerfile
 * is pulled from ECR by repository and tag, and its own CMD is the Lambda handler (the backend behind
 * an ASGI adapter), so the same application the Fargate path runs as a server runs here as a function
 * with no change to the backend. Referencing the image by repository and tag, exactly as the Fargate
 * service-stack references it by registry and tag, is what keeps `npm run synth` free of Docker, the
 * network, and an AWS account, which is what the EEP-IAC-01 gate needs and what lets one built image
 * promote across stages unchanged.
 */
export const IMAGE_REPOSITORY = "{{project_name}}-api";

/** The context key that carries the artifact reference: `--context imageTag=<sha>`. */
export const IMAGE_TAG_CONTEXT_KEY = "imageTag";

/**
 * The tag used when no imageTag context value is supplied.
 *
 * It is deliberately not `latest`: a stack that synthesizes with this tag is meant to be readable as
 * a template and impossible to deploy into a running function by accident, because no build ever
 * pushes this tag. Deploying without `--context imageTag=<sha>` therefore fails at the image pull
 * rather than quietly rolling a stage back to whatever `latest` pointed at.
 */
export const UNDEPLOYABLE_IMAGE_TAG = "no-image-tag-supplied-do-not-deploy";

export type ApiStackProps = StackProps & {
  /** The stage this instance of the template represents. See lib/environments.ts. */
  readonly environment: Environment;
};

/**
 * One stage of the HTTP API: an API Gateway HTTP API whose every route reaches one container image
 * Lambda running the backend.
 *
 * The stack is instantiated once per entry in `environments`, so dev, uat, and prod differ in scale,
 * retention, and naming rather than in shape.
 */
export class ApiStack extends Stack {
  readonly api: HttpApi;
  readonly handler: DockerImageFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { environment } = props;
    const imageTag = this.resolveImageTag();

    // The log group is declared here rather than left to AWS Lambda's implicit one, so retention is
    // part of the reviewed change and production logs survive a stack deletion.
    const logGroup = new LogGroup(this, "ApiFunctionLogs", {
      retention: environment.logRetentionDays,
      removalPolicy: environment.isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    // The image is referenced by repository and tag rather than built as a CDK asset, so synthesis
    // needs no Docker daemon and no network: the pull happens at deploy, against the image the
    // pipeline already pushed. AWS_REGION is not set below because the Lambda runtime provides it as
    // a reserved variable; the Fargate task, which has no such reservation, sets it explicitly.
    const repository = Repository.fromRepositoryName(this, "ApiRepository", IMAGE_REPOSITORY);

    this.handler = new DockerImageFunction(this, "ApiFunction", {
      code: DockerImageCode.fromEcr(repository, { tagOrDigest: imageTag }),
      memorySize: environment.memoryMb,
      // The HTTP API integration times out at thirty seconds, so a longer function timeout would only
      // hold a connection the gateway has already abandoned.
      timeout: Duration.seconds(30),
      environment: {
        STAGE: environment.stage,
        LOG_LEVEL: environment.isProduction ? "INFO" : "DEBUG",
        IMAGE_TAG: imageTag,
      },
      // Traces from the first commit, not from the first incident. The tracer inside the container
      // image adds subsegments to the segment this setting creates.
      tracing: Tracing.ACTIVE,
      logGroup,
    });

    this.api = new HttpApi(this, "HttpApi", {
      apiName: `${id}-api`,
      description: `HTTP API for the ${environment.stage} stage`,
      // Every route reaches the backend Lambda: the application owns its own routing, so the gateway
      // is a proxy in front of it rather than a second place routes are declared. A path the app does
      // not serve returns the app's own not-found response, which is the one its operator expects.
      defaultIntegration: new HttpLambdaIntegration("ApiIntegration", this.handler),
    });

    // Outputs are the deployment's contract with whatever runs next: a smoke test reads the URL, and
    // the stage name makes the promotion step's target unambiguous in the deploy log.
    new CfnOutput(this, "StageName", {
      value: environment.stage,
      description: "The stage this stack deploys",
    });
    new CfnOutput(this, "ApiUrl", {
      value: this.api.apiEndpoint,
      description: "Base URL of the HTTP API; the backend answers on it",
    });
  }

  /**
   * The artifact reference for this deployment, taken from `--context imageTag=<sha>`.
   *
   * Reading it as context rather than as a stack property is what lets one built image promote through
   * the stages unchanged: the pipeline passes the same tag to dev, then uat, then prod, and nothing in
   * this repository is edited between those three deploys.
   */
  private resolveImageTag(): string {
    const fromContext: unknown = this.node.tryGetContext(IMAGE_TAG_CONTEXT_KEY);
    if (typeof fromContext === "string" && fromContext.trim() !== "") return fromContext.trim();
    return UNDEPLOYABLE_IMAGE_TAG;
  }
}
