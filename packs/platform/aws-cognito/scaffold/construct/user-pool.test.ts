import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, it } from "vitest";
import { UserPool } from "./user-pool.js";

/**
 * Synthesizes a UserPool into a CloudFormation template, the same way a deploy would render it, with
 * no AWS credentials and no account lookup involved. Every assertion below reads the rendered
 * template rather than the construct object, so it proves what actually deploys.
 */
function synth(props: { owner: string; environment: string }): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  new UserPool(stack, "Auth", props);
  return Template.fromStack(stack);
}

describe("the user pool", () => {
  const template = synth({ owner: "platform-team", environment: "dev" });

  it("signs users in by email", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      UsernameAttributes: ["email"],
      AutoVerifiedAttributes: ["email"],
    });
  });

  it("enforces advanced security and a strong password policy", () => {
    // The two data-protection defaults the pool adds on top of Cognito's own at-rest encryption:
    // advanced security runs compromised-credential detection on every sign-in, and the password
    // policy fixes a twelve character floor across four character classes so the salted hash Cognito
    // stores is expensive to reverse.
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolAddOns: { AdvancedSecurityMode: "ENFORCED" },
      Policies: {
        PasswordPolicy: {
          MinimumLength: 12,
          RequireLowercase: true,
          RequireUppercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
        },
      },
    });
  });

  it("recovers accounts by verified email only", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AccountRecoverySetting: {
        RecoveryMechanisms: [{ Name: "verified_email", Priority: 1 }],
      },
    });
  });

  it("restricts the app client to the minimal auth flows", () => {
    // Least privilege on the client: exactly the SRP and refresh flows a first-party sign-in uses,
    // no static secret to leak, and user-existence errors suppressed so the pool is not enumerable.
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      ExplicitAuthFlows: Match.arrayWith(["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]),
      PreventUserExistenceErrors: "ENABLED",
      GenerateSecret: false,
    });
    // The admin and plain-password flows are proven absent, not merely unlisted: a Match.not over an
    // arrayWith fails the moment either flow appears, so widening the client reddens this assertion.
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      ExplicitAuthFlows: Match.not(Match.arrayWith(["ALLOW_ADMIN_USER_PASSWORD_AUTH"])),
    });
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      ExplicitAuthFlows: Match.not(Match.arrayWith(["ALLOW_USER_PASSWORD_AUTH"])),
    });
  });

  it("tags the user pool with an owner and an environment", () => {
    // Cognito renders tags as a UserPoolTags map rather than the standard tag array, so attribution
    // is asserted as two keys on that map. objectLike holds whatever other tags a stage layers on.
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolTags: Match.objectLike({ Owner: "platform-team", Environment: "dev" }),
    });
  });

  it("retains the pool when its stack is deleted", () => {
    template.hasResource("AWS::Cognito::UserPool", { DeletionPolicy: "Retain" });
  });

  it("provisions exactly one user pool and one app client", () => {
    template.resourceCountIs("AWS::Cognito::UserPool", 1);
    template.resourceCountIs("AWS::Cognito::UserPoolClient", 1);
  });
});

describe("the attribution tags", () => {
  // The tags carry the values a stage passes in, not constants baked into the construct, so a report
  // can group the estate by owner or environment. Supplying values that differ from the describe
  // block above proves the tag tracks the input rather than a hard coded default.
  const template = synth({ owner: "payments-team", environment: "prod" });

  it("carries the owner the stage supplied", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolTags: Match.objectLike({ Owner: "payments-team" }),
    });
  });

  it("carries the environment the stage supplied", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolTags: Match.objectLike({ Environment: "prod" }),
    });
  });
});
