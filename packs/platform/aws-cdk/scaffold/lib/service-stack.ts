import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, Tags } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "./environments";

/**
 * The container image repository this service runs. It is a placeholder: replace it with the real
 * registry path, an ECR repository URI such as
 * `111122223333.dkr.ecr.eu-west-1.amazonaws.com/{{project_name}}-api`, the first time this stack is
 * deployed against a real account. The tag beside it is never edited here, see IMAGE_TAG_CONTEXT_KEY.
 */
export const IMAGE_REPOSITORY = "{{project_name}}-api";

/** The context key that carries the artifact reference: `--context imageTag=<sha>`. */
export const IMAGE_TAG_CONTEXT_KEY = "imageTag";

/**
 * The tag used when no imageTag context value is supplied.
 *
 * It is deliberately not `latest`: a stack that synthesizes with this tag is meant to be readable
 * as a template and impossible to deploy into a running service by accident, because no build ever
 * pushes this tag. Deploying without `--context imageTag=<sha>` therefore fails at the registry
 * pull rather than quietly rolling a stage back to whatever `latest` pointed at.
 */
export const UNDEPLOYABLE_IMAGE_TAG = "no-image-tag-supplied-do-not-deploy";

/** The port the container listens on, matching the backend packs' service default. */
const CONTAINER_PORT = 8000;

export interface ServiceStackProps extends StackProps {
  readonly config: EnvironmentConfig;
}

/**
 * One stage of the service: a VPC, an ECS cluster, and a Fargate service behind an internet facing
 * application load balancer.
 *
 * Everything that differs between stages arrives through `props.config`, so the resource graph is
 * identical across dev, uat, and prod and only its scale and its retention change.
 */
export class ServiceStack extends Stack {
  public readonly service: ecsPatterns.ApplicationLoadBalancedFargateService;

  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);

    const { config } = props;
    const isProduction = config.isProduction;
    const imageTag = this.resolveImageTag();

    // Two availability zones: the minimum that survives one zone failing, and the maximum an
    // account agnostic stack can name without looking an account up. Non production runs with no
    // NAT gateway at all, which is the single largest idle cost in a small service (a NAT gateway
    // bills per hour whether or not a task is running), so its tasks sit in public subnets with a
    // public IP and reach the registry directly. Production keeps its tasks in private subnets and
    // pays for one NAT gateway per zone.
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: isProduction ? 2 : 0,
      subnetConfiguration: isProduction
        ? [
            { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
            { name: "private", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
          ]
        : [{ name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
    });

    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      // Container Insights is on in every stage: a metric that only exists in production is a
      // metric nobody has read before the incident that needs it.
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    const logGroup = new logs.LogGroup(this, "ServiceLogs", {
      retention: isProduction ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_WEEK,
      removalPolicy: isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    this.service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, "Service", {
      cluster,
      cpu: config.cpu,
      memoryLimitMiB: config.memoryLimitMiB,
      desiredCount: config.desiredCount,
      publicLoadBalancer: true,
      // Without a NAT gateway the task needs its own route to the registry, so non production tasks
      // run in the public subnets with a public IP and production tasks stay private.
      assignPublicIp: !isProduction,
      taskSubnets: {
        subnetType: isProduction ? ec2.SubnetType.PRIVATE_WITH_EGRESS : ec2.SubnetType.PUBLIC,
      },
      // A deployment that never reaches a healthy task rolls itself back instead of leaving the
      // stage half migrated while someone reads the console.
      circuitBreaker: { enable: true, rollback: true },
      // Production keeps its full capacity through a rolling deployment: new tasks come up before
      // old ones go away. Non production accepts a dip, which is what lets a single task stage
      // deploy without paying for a second one.
      minHealthyPercent: isProduction ? 100 : 50,
      healthCheckGracePeriod: Duration.seconds(60),
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(`${IMAGE_REPOSITORY}:${imageTag}`),
        containerPort: CONTAINER_PORT,
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: config.stage, logGroup }),
        environment: {
          STAGE: config.stage,
          IMAGE_TAG: imageTag,
        },
      },
    });

    // The load balancer decides a task is alive the same way an operator would: by asking the
    // service's own health endpoint, which every backend pack in this program serves.
    this.service.targetGroup.configureHealthCheck({
      path: "/health",
      healthyHttpCodes: "200",
      interval: Duration.seconds(30),
      timeout: Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });

    if (isProduction) {
      // Deletion protection is the load balancer's, because it is the resource that holds the DNS
      // name every client resolves: destroying it is the change no rollback can undo quickly.
      this.service.loadBalancer.setAttribute("deletion_protection.enabled", "true");
    }

    // Stage and project tags carry cost allocation: a bill split by stage is the only way an idle
    // non production environment shows up as a number rather than as a suspicion.
    Tags.of(this).add("Project", "{{project_name}}");
    Tags.of(this).add("Stage", config.stage);

    new CfnOutput(this, "ServiceUrl", {
      value: `http://${this.service.loadBalancer.loadBalancerDnsName}`,
      description: "Public URL of the load balancer fronting this stage",
    });

    new CfnOutput(this, "DeployedImageTag", {
      value: imageTag,
      description: "The image tag this stage was synthesized with",
    });
  }

  /**
   * The artifact reference for this deployment, taken from `--context imageTag=<sha>`.
   *
   * Reading it as context rather than as a stack property is what lets one built image promote
   * through the stages unchanged: the pipeline passes the same tag to dev, then uat, then prod, and
   * nothing in this repository is edited between those three deploys.
   */
  private resolveImageTag(): string {
    const fromContext: unknown = this.node.tryGetContext(IMAGE_TAG_CONTEXT_KEY);
    if (typeof fromContext === "string" && fromContext.trim() !== "") return fromContext.trim();
    return UNDEPLOYABLE_IMAGE_TAG;
  }
}
