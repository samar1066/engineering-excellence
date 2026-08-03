import { existsSync } from "node:fs";
import { Duration, RemovalPolicy, Tags } from "aws-cdk-lib";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  HttpVersion,
  PriceClass,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";

/**
 * The document CloudFront serves for the site root and the path a client route falls back to. A
 * single page app owns its own routing in the browser, so a deep link that S3 has no object for is
 * not a 404 to show the user but a request to hand the app its shell and let the router take over.
 */
export const SPA_ENTRYPOINT = "index.html";

/** The status a browser must be redirected to HTTPS at, and how long an SPA fallback is cached. */
const SPA_FALLBACK_TTL = Duration.minutes(5);

export interface FrontendHostingProps {
  /**
   * The owner tag applied to the hosting resources for cost attribution. It comes from the stage
   * that instantiates the construct rather than being typed here, so every resource in a deployment
   * inherits a consistent owner and a bill can be grouped by it.
   */
  readonly owner: string;
  /** The environment tag applied to the hosting resources, for the same reason as owner. */
  readonly environment: string;
  /**
   * The directory of built single page app assets to publish to the bucket. When it exists at synth
   * time a BucketDeployment uploads it and invalidates the distribution, so a deploy that follows a
   * frontend build serves the new app; when it is absent the bucket and the distribution are still
   * provisioned, so an infrastructure only synth (a fresh checkout, a template assertion) is never
   * blocked on a build that has not run.
   */
  readonly sitePath: string;
  /**
   * The removal policy for the site bucket. It defaults to RETAIN so a stack deletion never takes
   * the bucket with it; a throwaway stage can pass DESTROY, which also empties the bucket on delete.
   */
  readonly removalPolicy?: RemovalPolicy;
}

/**
 * A private S3 bucket fronted by a CloudFront distribution for serving a single page app, carrying
 * the properties the edge's laws demand: the bucket blocks all public access and is encrypted at
 * rest, CloudFront reaches it through an Origin Access Control and a bucket policy scoped to this one
 * distribution rather than a public bucket or a legacy origin identity, every viewer is redirected to
 * HTTPS, the app shell is the default root object, a 403 or a 404 is rewritten to the shell with a
 * 200 so client side routing works, and owner plus environment tags attribute the resources.
 *
 * It is a plain Construct rather than a Stack, so the aws-cdk service stack composes it beside the
 * service. The properties that prove the laws are declared explicitly rather than left to an account
 * default, so they are visible in the rendered template and a template assertion can hold them in
 * place.
 */
export class FrontendHosting extends Construct {
  public readonly bucket: Bucket;
  public readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: FrontendHostingProps) {
    super(scope, id);

    this.bucket = new Bucket(this, "SiteBucket", {
      // The site bucket is private: it is never a website endpoint and never public. The only reader
      // is the distribution in front of it, reaching it through the origin access control below.
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: props.removalPolicy ?? RemovalPolicy.RETAIN,
      autoDeleteObjects: props.removalPolicy === RemovalPolicy.DESTROY,
    });

    this.distribution = new Distribution(this, "Distribution", {
      defaultBehavior: {
        // withOriginAccessControl signs every origin request with SigV4 and renders a bucket policy
        // that lets only this distribution read the bucket, keyed on its ARN, so the private bucket
        // has exactly one reader and no public path.
        origin: S3BucketOrigin.withOriginAccessControl(this.bucket),
        // Redirect, not just allow: a viewer arriving over HTTP is sent to HTTPS rather than served,
        // so no response ever leaves the edge in the clear.
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // A static site is read only, so the cache serves GET and HEAD and nothing else, and the
        // managed optimized policy caches aggressively while honoring the origin's cache headers.
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
      },
      defaultRootObject: SPA_ENTRYPOINT,
      httpVersion: HttpVersion.HTTP2_AND_3,
      // North America and Europe edges only: the cheapest price class that still fronts the app from
      // more than one continent, which a stage that needs global reach overrides deliberately.
      priceClass: PriceClass.PRICE_CLASS_100,
      // A single page app routes in the browser, so a path the bucket has no object for is not an
      // error to surface but the app shell to serve with a 200, letting the router resolve the route.
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: `/${SPA_ENTRYPOINT}`,
          ttl: SPA_FALLBACK_TTL,
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: `/${SPA_ENTRYPOINT}`,
          ttl: SPA_FALLBACK_TTL,
        },
      ],
    });

    // The built assets are published only when they exist at synth time. A BucketDeployment uploads
    // the directory and invalidates the distribution so the new build is served immediately; an
    // absent directory leaves the bucket and the distribution in place and skips only the upload, so
    // a synth that runs before a build (a fresh checkout, a template assertion) is never blocked.
    if (existsSync(props.sitePath)) {
      new BucketDeployment(this, "DeploySite", {
        sources: [Source.asset(props.sitePath)],
        destinationBucket: this.bucket,
        distribution: this.distribution,
        distributionPaths: ["/*"],
        prune: true,
      });
    }

    Tags.of(this).add("Owner", props.owner);
    Tags.of(this).add("Environment", props.environment);
  }
}
