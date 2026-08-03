import { RemovalPolicy, Tags } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table, TableEncryption } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

/**
 * The partition key for the note reference domain. A note is looked up by its own id, so the table
 * needs no sort key and no secondary index: one item per note, keyed by id. An entity queried by
 * another attribute belongs on its own construct with its own key schema, not bolted on here.
 */
export const NOTE_PARTITION_KEY = "id";

export interface NoteTableProps {
  /**
   * The owner tag applied to the table for cost attribution. It comes from the stage that
   * instantiates the table rather than being typed here, so every table in a deployment inherits a
   * consistent owner and a bill can be grouped by it.
   */
  readonly owner: string;
  /** The environment tag applied to the table, for the same reason as owner. */
  readonly environment: string;
  /**
   * The physical table name. Left undefined by default so CloudFormation names the table and two
   * stages never collide on one name; set it when an existing table must be adopted by name.
   */
  readonly tableName?: string;
  /**
   * The removal policy for the table. A data store defaults to RETAIN so a stack deletion never
   * takes the only copy of the data with it; a throwaway stage can pass DESTROY deliberately.
   */
  readonly removalPolicy?: RemovalPolicy;
}

/**
 * A DynamoDB table for the note reference domain, carrying the properties the store's laws demand:
 * encryption at rest, point in time recovery, on demand billing, and owner plus environment tags.
 *
 * It is a plain Construct rather than a Stack, so the aws-cdk service stack composes it beside the
 * service that reads it. The properties that prove the laws are declared explicitly rather than left
 * to an account default, so they are visible in the rendered template and a template assertion can
 * hold them in place.
 */
export class NoteTable extends Construct {
  public readonly table: Table;

  constructor(scope: Construct, id: string, props: NoteTableProps) {
    super(scope, id);

    this.table = new Table(this, "Resource", {
      tableName: props.tableName,
      partitionKey: { name: NOTE_PARTITION_KEY, type: AttributeType.STRING },
      // On demand billing: an idle table costs almost nothing and no capacity is provisioned to
      // guess wrong about, which suits a store whose traffic follows the service in front of it.
      billingMode: BillingMode.PAY_PER_REQUEST,
      // AWS managed encryption emits an explicit SSESpecification into the template, so the at rest
      // guarantee is an asserted property rather than an invisible account default.
      encryption: TableEncryption.AWS_MANAGED,
      // Point in time recovery is the continuous backup that fixes the recovery point objective at
      // one second, so a corrupting write can be undone by restoring to the moment before it.
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: props.removalPolicy ?? RemovalPolicy.RETAIN,
    });

    Tags.of(this.table).add("Owner", props.owner);
    Tags.of(this.table).add("Environment", props.environment);
  }
}
