import { Duration, RemovalPolicy, Tags } from "aws-cdk-lib";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

/**
 * The window an unfinished multipart upload is kept before its parts are reclaimed. A part that was
 * uploaded and never completed is billed like any stored object, so a bounded abort keeps an
 * abandoned upload from becoming a silent line on the bill.
 */
export const ABORT_INCOMPLETE_UPLOAD_AFTER = Duration.days(7);

export interface UploadsBucketProps {
  /**
   * The owner tag applied to the bucket for cost attribution. It comes from the stage that
   * instantiates the bucket rather than being typed here, so every resource in a deployment inherits
   * a consistent owner and a bill can be grouped by it.
   */
  readonly owner: string;
  /** The environment tag applied to the bucket, for the same reason as owner. */
  readonly environment: string;
  /**
   * The physical bucket name. Left undefined by default so CloudFormation names the bucket and two
   * stages never collide on one name; set it when an existing bucket must be adopted by name.
   */
  readonly bucketName?: string;
  /**
   * The removal policy for the bucket. An upload store defaults to RETAIN so a stack deletion never
   * takes the only copy of the objects with it; a throwaway stage can pass DESTROY deliberately.
   */
  readonly removalPolicy?: RemovalPolicy;
}

/**
 * A private S3 bucket for application uploads, carrying the properties the store's laws demand:
 * server side encryption at rest, a bucket policy that denies any request not made over TLS, every
 * public access route blocked, a lifecycle rule that aborts incomplete multipart uploads, and owner
 * plus environment tags.
 *
 * It is a plain Construct rather than a Stack, so the aws-cdk service stack composes it beside the
 * service that writes to it. The properties that prove the laws are declared explicitly rather than
 * left to an account default, so they are visible in the rendered template and a template assertion
 * can hold them in place. Nothing here grants read or write; the service task role is granted the
 * exact scope it uses where the stack composes this bucket, so the bucket carries no standing access
 * of its own.
 */
export class UploadsBucket extends Construct {
  public readonly bucket: Bucket;

  constructor(scope: Construct, id: string, props: UploadsBucketProps) {
    super(scope, id);

    this.bucket = new Bucket(this, "Resource", {
      bucketName: props.bucketName,
      // Every public access route is blocked: the four settings together mean no ACL and no bucket
      // policy can ever open an object to the internet, so the only readers are principals granted
      // an explicit scope elsewhere.
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      // AWS managed server side encryption emits an explicit SSE configuration into the template, so
      // the at rest guarantee is an asserted property rather than an invisible account default.
      encryption: BucketEncryption.S3_MANAGED,
      // enforceSSL renders a bucket policy that denies any request whose aws:SecureTransport is
      // false, so a caller cannot reach an object over plain HTTP: every hop to this bucket is TLS.
      enforceSSL: true,
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: ABORT_INCOMPLETE_UPLOAD_AFTER }],
      removalPolicy: props.removalPolicy ?? RemovalPolicy.RETAIN,
      autoDeleteObjects: props.removalPolicy === RemovalPolicy.DESTROY,
    });

    Tags.of(this.bucket).add("Owner", props.owner);
    Tags.of(this.bucket).add("Environment", props.environment);
  }
}
