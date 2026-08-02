import { RetentionDays } from "aws-cdk-lib/aws-logs";

/**
 * One environment this API runs in.
 *
 * Every value that differs between environments enters the stack through this shape, so the three
 * environments are three instantiations of one reviewed template rather than three copies of a
 * definition that drift apart. Adding a fourth stage is one entry in the list below.
 */
export type Environment = {
  /** Stage name. Reaches the stack name, the function's STAGE variable, and a stack output. */
  readonly stage: string;
  /** Production carries retention and protection rules that non production deliberately does not. */
  readonly isProduction: boolean;
  /** Function memory. Also sets the CPU share AWS Lambda allocates, so it is a latency dial too. */
  readonly memoryMb: number;
  /** How long CloudWatch keeps this stage's function logs. */
  readonly logRetentionDays: RetentionDays;
};

// Account and region bind at deploy time, never in this file. bin/app.ts passes whatever the CDK
// CLI resolved into CDK_DEFAULT_ACCOUNT and CDK_DEFAULT_REGION from the credentials the command
// runs under, so `npm run synth` needs no credentials at all and continuous integration selects
// the target account per stage by assuming a role rather than by editing this list. Writing an
// account number here would put an account id in version control and make the definition
// unsynthesizable for everyone outside that account.
export const environments: readonly Environment[] = [
  { stage: "dev", isProduction: false, memoryMb: 256, logRetentionDays: RetentionDays.ONE_WEEK },
  { stage: "uat", isProduction: false, memoryMb: 512, logRetentionDays: RetentionDays.ONE_MONTH },
  {
    stage: "prod",
    isProduction: true,
    memoryMb: 1024,
    logRetentionDays: RetentionDays.SIX_MONTHS,
  },
];

/**
 * The environment named `stage`.
 *
 * Throws on an unknown stage rather than returning undefined: every caller is about to build a
 * stack out of the answer, and a silently missing environment would synthesize nothing while
 * looking like success.
 */
export function environmentFor(stage: string): Environment {
  const found = environments.find((environment) => environment.stage === stage);
  if (found === undefined) {
    const known = environments.map((environment) => environment.stage).join(", ");
    throw new Error(`unknown stage "${stage}"; known stages are ${known}`);
  }
  return found;
}
