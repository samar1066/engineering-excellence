#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { ApiStack } from "../lib/api-stack.js";
import { environments } from "../lib/environments.js";

// CloudFormation stack names accept letters, digits, and hyphens only, while an eep project name
// may carry underscores, so the project name is normalized once here.
const APP_NAME = "{{project_name}}".replaceAll("_", "-");

const app = new App();

// No context selects every environment, which is what `npm run synth` runs: one command renders
// all three stages, so a change is reviewed against production and non production at once. A
// deploy names one stage instead (`npx cdk deploy --all -c stage=uat`), so the pipeline can never
// reach a stage it was not asked for. See STACK.md, promotion contract.
const requestedStage = app.node.tryGetContext("stage") as string | undefined;
const selected =
  requestedStage === undefined
    ? environments
    : environments.filter((environment) => environment.stage === requestedStage);

if (selected.length === 0) {
  const known = environments.map((environment) => environment.stage).join(", ");
  throw new Error(`unknown stage "${requestedStage}"; known stages are ${known}`);
}

for (const environment of selected) {
  new ApiStack(app, `${APP_NAME}-${environment.stage}`, {
    environment,
    // Account and region come from the credentials the CDK CLI is running under. Undefined on a
    // machine with no credentials, which synthesizes an environment agnostic template rather than
    // failing, which is exactly what the verification gate needs.
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    description: `${APP_NAME} HTTP API, ${environment.stage} stage`,
    tags: { Application: APP_NAME, Stage: environment.stage },
  });
}
