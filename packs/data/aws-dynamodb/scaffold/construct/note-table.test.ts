import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, it } from "vitest";
import { NOTE_PARTITION_KEY, NoteTable } from "./note-table.js";

/**
 * Synthesizes a NoteTable into a CloudFormation template, the same way a deploy would render it,
 * with no AWS credentials and no account lookup involved. Every assertion below reads the rendered
 * template rather than the construct object, so it proves what actually deploys.
 */
function synth(props: { owner: string; environment: string }): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  new NoteTable(stack, "Notes", props);
  return Template.fromStack(stack);
}

describe("the note table", () => {
  const template = synth({ owner: "platform-team", environment: "dev" });

  it("encrypts the table at rest", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      SSESpecification: { SSEEnabled: true },
    });
  });

  it("keeps point in time recovery on for a defined recovery point", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });

  it("tags the table with an owner and an environment", () => {
    // Asserted one tag at a time: a single element arrayWith is a membership test, so it holds
    // whatever order CloudFormation renders the tag list in, which is alphabetical by key here.
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      Tags: Match.arrayWith([{ Key: "Owner", Value: "platform-team" }]),
    });
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      Tags: Match.arrayWith([{ Key: "Environment", Value: "dev" }]),
    });
  });

  it("bills on demand rather than provisioning capacity", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
    });
  });

  it("keys the note domain on its id", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [{ AttributeName: NOTE_PARTITION_KEY, KeyType: "HASH" }],
      AttributeDefinitions: Match.arrayWith([
        { AttributeName: NOTE_PARTITION_KEY, AttributeType: "S" },
      ]),
    });
  });

  it("retains the table when its stack is deleted", () => {
    template.hasResource("AWS::DynamoDB::Table", { DeletionPolicy: "Retain" });
  });

  it("provisions exactly one table", () => {
    template.resourceCountIs("AWS::DynamoDB::Table", 1);
  });
});

describe("the attribution tags", () => {
  // The tags carry the values a stage passes in, not constants baked into the construct, so a
  // report can group the estate by owner or environment. Supplying values that differ from the
  // describe block above proves the tag tracks the input rather than a hard coded default.
  const template = synth({ owner: "payments-team", environment: "prod" });

  it("carries the owner the stage supplied", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      Tags: Match.arrayWith([{ Key: "Owner", Value: "payments-team" }]),
    });
  });

  it("carries the environment the stage supplied", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      Tags: Match.arrayWith([{ Key: "Environment", Value: "prod" }]),
    });
  });
});
