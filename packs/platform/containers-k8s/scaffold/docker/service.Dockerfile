# Serves the service component scaffolded by the typescript-node stack pack (composed at service/).
# Build from the repository root so this file, the component, and .dockerignore share one context:
#   docker build -f docker/service.Dockerfile -t service:$(git rev-parse HEAD) .
# Two stages: a builder that installs from the lockfile, compiles TypeScript to dist/, then prunes
# development dependencies, and a runtime that copies only what the compiled entry point needs.

# --- builder -----------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /src

# Manifests first: this layer changes only when a dependency changes. npm ci installs exactly what
# package-lock.json records and fails when the two files disagree, so the image and a contributor's
# machine resolve the identical graph.
COPY service/package.json service/package-lock.json ./
RUN npm ci

COPY service/tsconfig.json service/tsconfig.build.json ./
COPY service/src ./src

# package.json build script: tsc -p tsconfig.build.json, which emits dist/ with main.js as entry.
RUN npm run build

# Development dependencies compiled the code and have no business in the runtime image.
RUN npm prune --omit=dev

# --- runtime -----------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# The node user (uid 1000) ships with the official image, so the runtime needs no account creation.
COPY --from=builder --chown=node:node /src/node_modules ./node_modules
COPY --from=builder --chown=node:node /src/dist ./dist
COPY --from=builder --chown=node:node /src/package.json ./package.json

USER node
EXPOSE 3000

# src/routes/health.ts serves GET /health. Node 22 has a global fetch, so the probe needs no client
# installed into the image.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
