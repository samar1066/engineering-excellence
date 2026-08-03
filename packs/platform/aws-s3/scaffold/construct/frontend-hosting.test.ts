import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, it } from "vitest";
import { FrontendHosting, SPA_ENTRYPOINT } from "./frontend-hosting.js";

// A tiny built site so the construct's BucketDeployment stages a real directory during synth, the
// same way a deploy would stage the frontend's dist output. It is a fixture, not the app: the point
// is that the publish step is present and wired to the bucket, not what the page says.
const here = dirname(fileURLToPath(import.meta.url));
const SITE_FIXTURE = join(here, "fixtures", "site");

/**
 * Synthesizes a FrontendHosting into a CloudFormation template, the same way a deploy would render
 * it, with no AWS credentials and no account lookup involved. Every assertion below reads the
 * rendered template rather than the construct object, so it proves what actually deploys.
 */
function synth(props: { owner: string; environment: string }): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  new FrontendHosting(stack, "Web", { ...props, sitePath: SITE_FIXTURE });
  return Template.fromStack(stack);
}

describe("the frontend hosting", () => {
  const template = synth({ owner: "platform-team", environment: "dev" });

  it("keeps the site bucket private and encrypted", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({ ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }),
        ]),
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it("serves the site only over HTTPS", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: "redirect-to-https" }),
      }),
    });
  });

  it("restricts bucket reads to the distribution through an origin access control", () => {
    // The private bucket has exactly one reader. An OAC signs the origin request, and the bucket
    // policy allows only s3:GetObject to the CloudFront service principal, scoped by AWS:SourceArn to
    // this one distribution, so no other principal and no public path can read the objects.
    template.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
    template.hasResourceProperties("AWS::CloudFront::OriginAccessControl", {
      OriginAccessControlConfig: Match.objectLike({
        OriginAccessControlOriginType: "s3",
        SigningBehavior: "always",
        SigningProtocol: "sigv4",
      }),
    });
    template.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "s3:GetObject",
            Effect: "Allow",
            Principal: { Service: "cloudfront.amazonaws.com" },
            Condition: { StringEquals: Match.objectLike({ "AWS:SourceArn": Match.anyValue() }) },
          }),
        ]),
      },
    });
  });

  it("serves the app shell as the default root object", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({ DefaultRootObject: SPA_ENTRYPOINT }),
    });
  });

  it("maps single page app routes through the app entrypoint", () => {
    // A 403 and a 404 are both rewritten to the app shell with a 200, so a deep link the bucket has
    // no object for hands the browser the app rather than an error, and client side routing resolves.
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({
            ErrorCode: 403,
            ResponseCode: 200,
            ResponsePagePath: `/${SPA_ENTRYPOINT}`,
          }),
          Match.objectLike({
            ErrorCode: 404,
            ResponseCode: 200,
            ResponsePagePath: `/${SPA_ENTRYPOINT}`,
          }),
        ]),
      }),
    });
  });

  it("publishes the built site to the bucket", () => {
    template.resourceCountIs("Custom::CDKBucketDeployment", 1);
  });

  it("provisions exactly one site bucket and one distribution", () => {
    template.resourceCountIs("AWS::S3::Bucket", 1);
    template.resourceCountIs("AWS::CloudFront::Distribution", 1);
  });

  it("tags the site bucket with an owner and an environment", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      Tags: Match.arrayWith([{ Key: "Owner", Value: "platform-team" }]),
    });
    template.hasResourceProperties("AWS::S3::Bucket", {
      Tags: Match.arrayWith([{ Key: "Environment", Value: "dev" }]),
    });
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
