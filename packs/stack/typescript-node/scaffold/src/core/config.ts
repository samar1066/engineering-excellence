export type Settings = {
  serviceName: string;
  logLevel: string;
  port: number;
};

export const settings: Settings = {
  serviceName: process.env.SERVICE_NAME ?? "{{project_name}}",
  logLevel: process.env.LOG_LEVEL ?? "info",
  port: Number(process.env.PORT ?? "3000"),
};
