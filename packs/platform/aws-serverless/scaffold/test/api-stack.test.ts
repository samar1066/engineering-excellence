import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { ApiStack } from "../lib/api-stack.js";
import { environmentFor } from "../lib/environments.js";

/**
 * The synthesized CloudFormation template for one stage.
 *
 * Every assertion below runs against the template rather than against the TypeScript that built
 * it, because the template is what AWS actually receives: a construct that compiles cleanly and
 * renders the wrong resource is the failure worth catching.
 */
function templateFor(stage: string): Template {
  const app = new App();
  const stack = new ApiStack(app, `test-${stage}`, { environment: environmentFor(stage) });
  return Template.fromStack(stack);
}

function memorySizeOf(template: Template): number {
  const functions = Object.values(template.findResources("AWS::Lambda::Function"));
  const memorySize = functions[0]?.Properties?.MemorySize;
  if (typeof memorySize !== "number") throw new Error("no Lambda function with a MemorySize");
  return memorySize;
}

describe("ApiStack", () => {
  it("puts an HTTP API in front of the handler", () => {
    const template = templateFor("dev");

    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    template.hasResourceProperties(
      "AWS::ApiGatewayV2::Api",
      Match.objectLike({ ProtocolType: "HTTP" }),
    );
    template.hasResourceProperties(
      "AWS::ApiGatewayV2::Route",
      Match.objectLike({ RouteKey: "GET /health" }),
    );
  });

  it("runs the handler on the Node 22 runtime with tracing on", () => {
    const template = templateFor("dev");

    template.hasResourceProperties(
      "AWS::Lambda::Function",
      Match.objectLike({
        Runtime: "nodejs22.x",
        Handler: "index.handler",
        TracingConfig: { Mode: "Active" },
      }),
    );
  });

  it("passes the stage into the handler's environment", () => {
    const template = templateFor("uat");

    template.hasResourceProperties(
      "AWS::Lambda::Function",
      Match.objectLike({
        Environment: Match.objectLike({ Variables: { STAGE: "uat", LOG_LEVEL: "DEBUG" } }),
      }),
    );
  });

  it("sizes production differently from development", () => {
    const dev = memorySizeOf(templateFor("dev"));
    const prod = memorySizeOf(templateFor("prod"));

    expect(dev).not.toBe(prod);
    expect(prod).toBeGreaterThan(dev);
  });

  it("keeps production logs longer and retains them on stack deletion", () => {
    templateFor("dev").hasResourceProperties(
      "AWS::Logs::LogGroup",
      Match.objectLike({ RetentionInDays: 7 }),
    );
    const prod = templateFor("prod");
    prod.hasResourceProperties("AWS::Logs::LogGroup", Match.objectLike({ RetentionInDays: 180 }));
    prod.hasResource("AWS::Logs::LogGroup", Match.objectLike({ DeletionPolicy: "Retain" }));
  });

  it("outputs the stage and the API URL", () => {
    const template = templateFor("prod");

    template.hasOutput("StageName", Match.objectLike({ Value: "prod" }));
    template.hasOutput("ApiUrl", Match.objectLike({ Value: Match.anyValue() }));
  });
});
