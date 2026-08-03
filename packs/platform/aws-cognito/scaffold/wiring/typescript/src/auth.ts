import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { preHandlerHookHandler } from "fastify";
import { settings } from "./core/config.js";

/**
 * The verified subset of a Cognito access token the application trusts downstream. Only the fields
 * the backend actually reads are lifted out of the raw claims; everything else the token carries
 * stays in Cognito. This is the shape a route sees on `request.user`.
 */
export type AuthenticatedUser = {
  sub: string;
  username?: string;
  clientId?: string;
  scope?: string;
  groups?: string[];
};

// The guard hangs the authenticated caller off the request so a downstream handler can read it.
declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

// The verifier fetches and caches the pool JWKS internally and, on every call, checks the RS256
// signature, the issuer, the expiry, the token_use, and the client id, so the guard below only has
// to pull the bearer token off the request and reshape the library's result. It is built once and
// lazily, so importing this module opens no connection and a request with no token touches no
// Cognito endpoint.
let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

function getVerifier(): ReturnType<typeof CognitoJwtVerifier.create> {
  if (verifier === null) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: settings.cognitoUserPoolId,
      tokenUse: "access",
      clientId: settings.cognitoClientId,
    });
  }
  return verifier;
}

/**
 * A Fastify preHandler that authenticates a request by its bearer token as a Cognito access token.
 *
 * Registered as a hook on the guarded routes, it runs before every one of them and short-circuits an
 * unauthenticated request with a 401 rather than letting the handler run. On success it sets
 * `request.user` to the verified caller. The API test suite swaps this guard for one that injects a
 * fake user, which is what lets the guarded routes stay green with no real Cognito in the loop.
 */
export const requireUser: preHandlerHookHandler = async (request, reply) => {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith("Bearer ")) {
    return reply.code(401).send({ detail: "missing bearer token" });
  }
  const token = header.slice("Bearer ".length);
  try {
    const claims = await getVerifier().verify(token);
    const groups = claims["cognito:groups"];
    request.user = {
      sub: claims.sub,
      username: typeof claims.username === "string" ? claims.username : undefined,
      clientId: typeof claims.client_id === "string" ? claims.client_id : undefined,
      scope: typeof claims.scope === "string" ? claims.scope : undefined,
      groups: Array.isArray(groups) ? groups : undefined,
    };
  } catch {
    return reply.code(401).send({ detail: "invalid or expired authentication token" });
  }
};
