import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { requireUser } from "../src/auth.js";

/**
 * Behavioral tests for the guard's reject path, which needs no Cognito: a request that carries no
 * usable bearer token is turned away with a 401 before the verifier is ever consulted. The accept
 * path (a well formed RS256 access token with the right issuer, token_use, and client id) is proven
 * exhaustively by the Python guard's unit test against a mocked JWKS; the TypeScript guard delegates
 * that same validation to aws-jwt-verify, and what is worth proving here is that it is wired as a
 * preHandler that fails closed.
 */
async function protectedApp() {
  const app = Fastify();
  app.addHook("preHandler", requireUser);
  app.get("/protected", () => ({ ok: true }));
  await app.ready();
  return app;
}

describe("requireUser", () => {
  it("rejects a request with no authorization header", async () => {
    const app = await protectedApp();
    const response = await app.inject({ method: "GET", url: "/protected" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("rejects an authorization header that is not a bearer token", async () => {
    const app = await protectedApp();
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
