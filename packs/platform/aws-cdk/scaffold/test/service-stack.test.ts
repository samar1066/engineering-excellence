import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { environments, type Stage, stackName, stages } from "../lib/environments";
import { ServiceStack, UNDEPLOYABLE_IMAGE_TAG } from "../lib/service-stack";

/**
 * Synthesizes one stage into a CloudFormation template, the same way `npm run synth` does, with no
 * AWS credentials and no account lookup involved.
 */
function synth(stage: Stage, context: Record<string, unknown> = {}): Template {
  const app = new App({ context });
  const stack = new ServiceStack(app, stackName("proof", stage), { config: environments[stage] });
  return Template.fromStack(stack);
}

function desiredCountOf(stage: Stage): number {
  const services = synth(stage).findResources("AWS::ECS::Service");
  const properties = Object.values(services)[0]?.Properties as
    | { DesiredCount?: number }
    | undefined;
  if (properties?.DesiredCount === undefined) throw new Error(`no ECS service in ${stage}`);
  return properties.DesiredCount;
}

describe.each(stages)("the %s stage", (stage) => {
  const config = environments[stage];

  it("fronts the service with an internet facing application load balancer", () => {
    synth(stage).hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
      Scheme: "internet-facing",
      Type: "application",
    });
  });

  it("runs the stage's own desired count on fargate", () => {
    synth(stage).hasResourceProperties("AWS::ECS::Service", {
      LaunchType: "FARGATE",
      DesiredCount: config.desiredCount,
    });
  });

  it("rolls a failed deployment back through the circuit breaker", () => {
    synth(stage).hasResourceProperties("AWS::ECS::Service", {
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      }),
    });
  });

  it("sizes the task from the stage table", () => {
    synth(stage).hasResourceProperties("AWS::ECS::TaskDefinition", {
      Cpu: String(config.cpu),
      Memory: String(config.memoryLimitMiB),
    });
  });

  it("health checks the service on /health", () => {
    synth(stage).hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      HealthCheckPath: "/health",
      Matcher: { HttpCode: "200" },
    });
  });

  it("spreads the network across two availability zones", () => {
    synth(stage).resourceCountIs("AWS::EC2::Subnet", config.isProduction ? 4 : 2);
  });
});

describe("the stage table", () => {
  // The point of a parameterized definition is that the parameters actually reach the template. A
  // stack that ignored its config would still pass every per stage assertion above, because each
  // one reads the same table the stack read; only comparing two stages catches it.
  it("gives dev and prod different desired counts", () => {
    expect(desiredCountOf("dev")).not.toBe(desiredCountOf("prod"));
    expect(desiredCountOf("prod")).toBe(environments.prod.desiredCount);
  });

  it("declares uat as a non production stage of its own", () => {
    expect(environments.uat.isProduction).toBe(false);
    expect(environments.uat.stage).not.toBe(environments.prod.stage);
    expect(stackName("shop", "uat")).not.toBe(stackName("shop", "prod"));
  });

  it("normalizes a project name CloudFormation would reject", () => {
    expect(stackName("my_shop", "dev")).toBe("my-shop-dev");
  });

  it("buys no NAT gateway outside production", () => {
    synth("dev").resourceCountIs("AWS::EC2::NatGateway", 0);
    synth("uat").resourceCountIs("AWS::EC2::NatGateway", 0);
    synth("prod").resourceCountIs("AWS::EC2::NatGateway", 2);
  });

  // The load balancer construct always renders this attribute, so the assertion is on its value in
  // each stage rather than on its presence in one of them.
  it("protects only the production load balancer from deletion", () => {
    synth("prod").hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
      LoadBalancerAttributes: Match.arrayWith([
        { Key: "deletion_protection.enabled", Value: "true" },
      ]),
    });
    for (const stage of ["dev", "uat"] as const) {
      synth(stage).hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
        LoadBalancerAttributes: Match.arrayWith([
          { Key: "deletion_protection.enabled", Value: "false" },
        ]),
      });
    }
  });
});

describe("the image tag context parameter", () => {
  it("carries the supplied tag into the container image", () => {
    synth("uat", { imageTag: "sha-abc123" }).hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({ Image: Match.stringLikeRegexp(":sha-abc123$") }),
      ]),
    });
  });

  it("falls back to a tag no build ever pushes", () => {
    synth("prod").hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({ Image: Match.stringLikeRegexp(`:${UNDEPLOYABLE_IMAGE_TAG}$`) }),
      ]),
    });
  });

  it("deploys one artifact reference to every stage it is given", () => {
    for (const stage of stages) {
      synth(stage, { imageTag: "sha-deadbeef" }).hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({ Image: Match.stringLikeRegexp(":sha-deadbeef$") }),
        ]),
      });
    }
  });
});
