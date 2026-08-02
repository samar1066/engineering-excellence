---
title: environments setup
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

# environments setup

The deployment workflow this pack scaffolds carries no account identifiers, no
role names, and no approver lists. All of it is configuration, and this is the
order to create it in. Every value below is a placeholder: substitute your own.

## 1. Create the three environments

In the repository, open Settings, then Environments, and create three:

1. `dev`, with no protection rules. This stage exists to prove the artifact
   starts and serves before anyone is asked to approve it.
2. `uat`, with required reviewers.
3. `production`, with required reviewers.

The names must match the `environment:` keys in
`.github/workflows/deploy.yml`. Renaming an environment means editing both.

## 2. Attach reviewers to the two protected environments

On `uat` and on `production`, enable Required reviewers and name the people or
teams who may approve a deployment to that stage. A run reaching either stage
pauses until one of them approves it, and the approval is recorded against the
deployment.

Two settings are worth turning on with it. Prevent self review, so the person
who opened the change is not the person who waves it through. A wait timer on
`production`, even a short one, gives the uat stage time to be observed rather
than clicked past.

## 3. Create the OIDC identity provider in AWS

In the AWS account that will receive deployments, create an IAM OpenID Connect
identity provider if one does not already exist:

- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

One provider serves every repository in the account. Create it once.

## 4. Create the deployment role

Create an IAM role whose trust policy admits only this repository through that
provider. The condition block is the part that matters: without a `sub`
condition, any repository on GitHub can assume the role.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": { "token.actions.githubusercontent.com:sub": "repo:<org>/<repo>:*" }
    }
  }]
}
```

Narrow the `sub` pattern as far as your branching model allows. Three useful
shapes, in increasing strictness:

1. `repo:<org>/<repo>:*`, any ref in the repository. The loosest form that is
   still repository scoped.
2. `repo:<org>/<repo>:ref:refs/heads/<branch>`, one branch only.
3. `repo:<org>/<repo>:environment:<environment-name>`, one environment only,
   which is the tightest and pairs naturally with a role per stage.

The role needs permission to push to the ECR repository and to run the
CloudFormation deployment the CDK application performs. Grant those two and
nothing else, and prefer a separate role per environment over one role that
can reach every account.

## 5. Set the variables

Under Settings, Secrets and variables, Actions, Variables, set three
repository variables. No secret is required, because OIDC leaves nothing to
store:

| Variable | Value |
|----------|-------|
| `AWS_ROLE_ARN` | `arn:aws:iam::<account-id>:role/<role-name>` |
| `AWS_REGION` | the region holding the ECR repository and the stacks |
| `ECR_REPOSITORY` | the ECR repository name the image is pushed to |

If a stage deploys to its own account, set `AWS_ROLE_ARN` and `AWS_REGION`
again as environment variables on that environment. Environment values
override repository values for the jobs that name the environment, so one
account per stage needs no edit to the workflow.

## 6. Require the gate

Under Settings, Rules or Branch protection, require the `gate` status check
from `ci.yml` before a change can merge. That check is the one job that turns
red when any component gate fails and stays green when a component is not part
of the repository yet.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
