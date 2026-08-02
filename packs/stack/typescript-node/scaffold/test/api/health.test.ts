import { describe, expect, it } from "vitest";
import { useApp } from "../helpers/app.js";

const app = useApp();

describe("GET /health", () => {
  it("reports ok", async () => {
    const response = await app().inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("echoes a correlation id on the response", async () => {
    const response = await app().inject({
      method: "GET",
      url: "/health",
      headers: { "x-correlation-id": "given-by-the-caller" },
    });

    expect(response.headers["x-correlation-id"]).toBe("given-by-the-caller");
  });
});
