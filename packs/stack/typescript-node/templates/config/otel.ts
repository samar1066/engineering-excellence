import { FastifyOtelInstrumentation } from "@fastify/otel";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { FastifyInstance } from "fastify";

// One tracer provider per process, held here because OpenTelemetry refuses to replace a provider
// that is already global. Tests build several applications in one process, so the SDK is started
// on the first call and every later application registers its own fastify instrumentation against
// the provider that already exists.
let sdk: NodeSDK | undefined;

// Vitest exports VITEST for the whole run, so it is already set while the test files import this
// module. Under it the provider is given no span processor: spans are still recorded and dropped,
// while the console exporter would otherwise interleave span dumps with the test report and flush
// again at exit, after vitest has closed the output it writes into. Tracing is proved by this
// module and its wiring, never by spans printed mid test.
function spanProcessors(): SpanProcessor[] {
  if (process.env.VITEST !== undefined) return [];
  return [new SimpleSpanProcessor(new ConsoleSpanExporter())];
}

/**
 * Initializes tracing once and instruments this application's entry points. Call it once, from
 * createApp, and never from a request path: the process gets one tracer provider.
 */
export function configureTracing(app: FastifyInstance, serviceName: string): void {
  if (sdk === undefined) {
    sdk = new NodeSDK({
      resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
      spanProcessors: spanProcessors(),
    });
    sdk.start();
  }
  const instrumentation = new FastifyOtelInstrumentation();
  instrumentation.enable();
  app.register(instrumentation.plugin());
}
