#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { environments, stackName } from "../lib/environments";
import { ServiceStack } from "../lib/service-stack";

/** The project this infrastructure belongs to. It prefixes every stack name. */
const PROJECT_NAME = "{{project_name}}";

const app = new App();

// One stack per entry in the stage table, named `<project>-<stage>`, so `cdk deploy shop-uat`
// names exactly one environment and `cdk synth --all` renders every one of them in a single run.
for (const config of Object.values(environments)) {
  new ServiceStack(app, stackName(PROJECT_NAME, config.stage), {
    config,
    description: `${PROJECT_NAME} service, ${config.stage} stage`,
    // The account and region come from the credentials the deploy runs under, never from a table in
    // this repository. Both are undefined during a credential free synth, which leaves the stack
    // environment agnostic and lets the template render anywhere.
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
  });
}
