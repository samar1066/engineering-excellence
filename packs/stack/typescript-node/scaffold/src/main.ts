import { createApp } from "./app.js";
import { settings } from "./core/config.js";

const app = createApp();

try {
  await app.listen({ port: settings.port, host: "0.0.0.0" });
} catch (error) {
  app.log.error({ err: error }, "failed to start");
  process.exit(1);
}
