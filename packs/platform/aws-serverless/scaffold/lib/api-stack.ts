import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Code, Function as LambdaFunction, Runtime, Tracing } from "aws-cdk-lib/aws-lambda";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import type { Environment } from "./environments.js";

export type ApiStackProps = StackProps & {
  /** The stage this instance of the template represents. See lib/environments.ts. */
  readonly environment: Environment;
};

// The scaffold's handler is inline on purpose. Inline code carries no bundler, no Docker daemon,
// and no network into `npm run synth`, so the EEP-IAC-01 check runs from a clean checkout on any
// machine, including a continuous integration runner with no credentials.
//
// The upgrade path, for the first handler with real dependencies: move this handler into
// src/handlers/health.ts, add @aws-lambda-powertools/logger and aws-cdk-lib's NodejsFunction
// (from aws-cdk-lib/aws-lambda-nodejs), and swap the construct below for
//
//   import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
//   const healthFunction = new NodejsFunction(this, "HealthFunction", {
//     entry: "src/handlers/health.ts",
//     runtime: Runtime.NODEJS_22_X,
//     memorySize: environment.memoryMb,
//     timeout: Duration.seconds(10),
//     environment: { STAGE: environment.stage, POWERTOOLS_SERVICE_NAME: "api" },
//     logGroup,
//     bundling: { minify: true, sourceMap: true },
//   });
//
// NodejsFunction bundles with esbuild, which becomes a build time dependency of `cdk synth`.
// Install esbuild as a devDependency at that point, otherwise the construct falls back to
// bundling inside Docker and the check starts needing a running daemon. See STACK.md.
const HEALTH_HANDLER = `exports.handler = async (event) => {
  const stage = process.env.STAGE ?? "unknown";
  const requestId = event?.requestContext?.requestId ?? "unknown";
  // One JSON object per line: CloudWatch Logs Insights parses these into queryable fields, and
  // request_id is the correlation identifier that ties this line to the API Gateway access log.
  console.log(
    JSON.stringify({ level: "info", message: "health checked", stage, request_id: requestId }),
  );
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "ok", stage }),
  };
};
`;

/**
 * One stage of the HTTP API: an API Gateway HTTP API in front of one Lambda function.
 *
 * The stack is instantiated once per entry in `environments`, so dev, uat, and prod differ in
 * scale, retention, and naming rather than in shape.
 */
export class ApiStack extends Stack {
  readonly api: HttpApi;
  readonly handler: LambdaFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { environment } = props;

    // The log group is declared here rather than left to AWS Lambda's implicit one, so retention
    // is part of the reviewed change and production logs survive a stack deletion.
    const logGroup = new LogGroup(this, "HealthFunctionLogs", {
      retention: environment.logRetentionDays,
      removalPolicy: environment.isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    this.handler = new LambdaFunction(this, "HealthFunction", {
      runtime: Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: Code.fromInline(HEALTH_HANDLER),
      memorySize: environment.memoryMb,
      timeout: Duration.seconds(10),
      environment: {
        STAGE: environment.stage,
        LOG_LEVEL: environment.isProduction ? "INFO" : "DEBUG",
      },
      // Traces from the first commit, not from the first incident. The Powertools tracer inside a
      // real handler adds subsegments to the segment this setting creates.
      tracing: Tracing.ACTIVE,
      logGroup,
    });

    this.api = new HttpApi(this, "HttpApi", {
      apiName: `${id}-api`,
      description: `HTTP API for the ${environment.stage} stage`,
    });

    this.api.addRoutes({
      path: "/health",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("HealthIntegration", this.handler),
    });

    // Outputs are the deployment's contract with whatever runs next: a smoke test reads the URL,
    // and the stage name makes the promotion step's target unambiguous in the deploy log.
    new CfnOutput(this, "StageName", {
      value: environment.stage,
      description: "The stage this stack deploys",
    });
    new CfnOutput(this, "ApiUrl", {
      value: this.api.apiEndpoint,
      description: "Base URL of the HTTP API; /health answers on it",
    });
  }
}
