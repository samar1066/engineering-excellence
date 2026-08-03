export type Settings = {
  serviceName: string;
  logLevel: string;
  port: number;
  cognitoUserPoolId: string;
  cognitoClientId: string;
  awsRegion: string;
};

export const settings: Settings = {
  serviceName: process.env.SERVICE_NAME ?? "{{project_name}}",
  logLevel: process.env.LOG_LEVEL ?? "info",
  port: Number(process.env.PORT ?? "3000"),
  // The Cognito coordinates the auth guard validates access tokens against, read from the
  // environment the infrastructure passes into the service.
  cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID ?? "",
  cognitoClientId: process.env.COGNITO_CLIENT_ID ?? "",
  awsRegion: process.env.AWS_REGION ?? "us-east-1",
};
