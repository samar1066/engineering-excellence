import { describe, expect, it } from "vitest";
import { configureLogging, runWithCorrelationId } from "../../src/core/logging.js";

function captureLines(): { lines: string[]; write: (chunk: string) => void } {
  const lines: string[] = [];
  return { lines, write: (chunk: string) => void lines.push(chunk) };
}

describe("configureLogging", () => {
  it("stamps the correlation id on every line logged inside the context", () => {
    const captured = captureLines();
    const logger = configureLogging("info", captured);

    runWithCorrelationId("cid-1", () => {
      logger.info("handled");
    });

    expect(JSON.parse(captured.lines[0] ?? "{}")).toMatchObject({
      correlation_id: "cid-1",
      msg: "handled",
    });
  });

  it("leaves the field off when no unit of work is bound", () => {
    const captured = captureLines();

    configureLogging("info", captured).info("startup");

    expect(JSON.parse(captured.lines[0] ?? "{}")).not.toHaveProperty("correlation_id");
  });
});
