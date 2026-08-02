/**
 * The stage table: the one place an environment is declared.
 *
 * Every stage instantiates the same ServiceStack, so stages differ in scale and in the isProduction
 * flag rather than in shape, and a change proven in dev is real evidence about prod. Adding a stage
 * is one entry here plus one deploy, never a copied stack file.
 *
 * Accounts and regions are deliberately absent from this table. They bind at deploy time from the
 * standard CDK_DEFAULT_ACCOUNT and CDK_DEFAULT_REGION variables that the CDK CLI exports from
 * whichever credentials the caller holds, so `npm run synth` succeeds from a clean checkout with no
 * AWS credentials at all, and the same reviewed definition targets a separate account per stage
 * without a per account copy of the code.
 */

export type Stage = "dev" | "uat" | "prod";

/**
 * The port the container listens on when a stage does not say otherwise. It is the backend packs'
 * service port, because the api component is what this stack deploys.
 */
export const DEFAULT_CONTAINER_PORT = 8000;

/** The path the load balancer health checks when a stage does not say otherwise. */
export const DEFAULT_HEALTH_CHECK_PATH = "/health";

export interface EnvironmentConfig {
  /** The stage name. It prefixes nothing on its own: stackName below builds the stack name. */
  readonly stage: Stage;
  /** Production only behavior hangs off this flag, never off a string comparison at the call site. */
  readonly isProduction: boolean;
  /** Fargate tasks the service runs. Non production stays small on purpose. */
  readonly desiredCount: number;
  /** Task CPU units: 256 is 0.25 vCPU. */
  readonly cpu: number;
  /** Task memory in MiB. Fargate accepts a fixed set of pairs with cpu. */
  readonly memoryLimitMiB: number;
  /**
   * Port the container listens on. Omitted means DEFAULT_CONTAINER_PORT. Set it when the image this
   * stage runs listens somewhere else, for example a static frontend image on 8080.
   */
  readonly containerPort?: number;
  /**
   * Path the target group health checks. Omitted means DEFAULT_HEALTH_CHECK_PATH. Set it when the
   * image this stage runs has no /health endpoint, for example a frontend serving "/".
   */
  readonly healthCheckPath?: string;
}

export const environments: Record<Stage, EnvironmentConfig> = {
  dev: { stage: "dev", isProduction: false, desiredCount: 1, cpu: 256, memoryLimitMiB: 512 },
  uat: { stage: "uat", isProduction: false, desiredCount: 2, cpu: 512, memoryLimitMiB: 1024 },
  prod: { stage: "prod", isProduction: true, desiredCount: 3, cpu: 1024, memoryLimitMiB: 2048 },
};

export const stages = Object.keys(environments) as Stage[];

/**
 * The stack name for one project and stage, for example `shop-dev`.
 *
 * CloudFormation accepts letters, digits, and hyphens in a stack name and nothing else, while a
 * project name may legally carry an underscore, so every character outside that set becomes a
 * hyphen here rather than failing at synth time with a regular expression in the message.
 */
export function stackName(project: string, stage: Stage): string {
  return `${project.replace(/[^A-Za-z0-9-]/g, "-")}-${stage}`;
}
