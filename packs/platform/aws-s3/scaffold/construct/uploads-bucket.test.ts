import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, it } from "vitest";
import { UploadsBucket } from "./uploads-bucket.js";

/**
 * Synthesizes an UploadsBucket into a CloudFormation template, the same way a deploy would render it,
 * with no AWS credentials and no account lookup involved. Every assertion below reads the rendered
 * template rather than the construct object, so it proves what actually deploys.
 */
function synth(props: { owner: string; environment: string }): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  new UploadsBucket(stack, "Uploads", props);
  return Template.fromStack(stack);
}

describe("the uploads bucket", () => {
  const template = synth({ owner: "platform-team", environment: "dev" });

  it("encrypts objects at rest and rejects plaintext transport", () => {
    // At rest: server side encryption is on with an explicit SSE configuration in the template.
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({ ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }),
        ]),
      },
    });
    // In transit: the bucket policy denies any request that did not arrive over TLS, so there is no
    // plaintext hop a caller can fall back to.
    template.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Deny",
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          }),
        ]),
      },
    });
  });

  it("blocks every public access route to the bucket", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it("aborts incomplete multipart uploads after a bounded window", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
            Status: "Enabled",
          }),
        ]),
      },
    });
  });

  it("tags the uploads bucket with an owner and an environment", () => {
    // Asserted one tag at a time: a single element arrayWith is a membership test, so it holds
    // whatever order CloudFormation renders the tag list in.
    template.hasResourceProperties("AWS::S3::Bucket", {
      Tags: Match.arrayWith([{ Key: "Owner", Value: "platform-team" }]),
    });
    template.hasResourceProperties("AWS::S3::Bucket", {
      Tags: Match.arrayWith([{ Key: "Environment", Value: "dev" }]),
    });
  });

  it("retains the uploads bucket when its stack is deleted", () => {
    template.hasResource("AWS::S3::Bucket", { DeletionPolicy: "Retain" });
  });

  it("provisions exactly one uploads bucket", () => {
    template.resourceCountIs("AWS::S3::Bucket", 1);
  });
});

describe("the attribution tags", () => {
  // The tags carry the values a stage passes in, not constants baked into the construct, so a report
  // can group the estate by owner or environment. Supplying values that differ from the describe
  // block above proves the tag tracks the input rather than a hard coded default.
  const template = synth({ owner: "payments-team", environment: "prod" });

  it("carries the owner the stage supplied", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      Tags: Match.arrayWith([{ Key: "Owner", Value: "payments-team" }]),
    });
  });

  it("carries the environment the stage supplied", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      Tags: Match.arrayWith([{ Key: "Environment", Value: "prod" }]),
    });
  });
});
