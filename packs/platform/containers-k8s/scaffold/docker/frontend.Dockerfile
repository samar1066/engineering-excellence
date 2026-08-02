# Serves the frontend component scaffolded by the react stack pack (composed at frontend/).
# Build from the repository root so this file, the component, docker/nginx.conf, and .dockerignore
# share one context:
#   docker build -f docker/frontend.Dockerfile -t frontend:$(git rev-parse HEAD) .
# Two stages: a node builder that type checks and bundles the interface, and an nginx runtime that
# serves the bundle as static files and proxies the API prefix to the backend.

# --- builder -----------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /src

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# Vite inlines import.meta.env.VITE_API_URL at build time, so the API base URL is a build argument
# rather than runtime environment. The default keeps every request same origin, which is what the
# nginx stage below is configured to proxy.
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

# package.json build script: tsc --noEmit && vite build, which writes dist/ per vite.config.ts.
RUN npm run build

# --- runtime -----------------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# The one address the interface talks to. Substituted into the upstream block at build time and
# overridden with --build-arg BACKEND_UPSTREAM=host:port for an environment that places the API
# somewhere other than the compose service name.
ARG BACKEND_UPSTREAM=backend:8000

# docker/nginx.conf is a complete configuration, not a conf.d fragment: it runs unprivileged, keeps
# its pid and temporary files under /tmp, and listens on 8080. The image's own default site would
# bind port 80, which an unprivileged process cannot do, so it is removed.
COPY docker/nginx.conf /etc/nginx/nginx.conf
RUN sed -i "s|BACKEND_UPSTREAM_PLACEHOLDER|${BACKEND_UPSTREAM}|g" /etc/nginx/nginx.conf \
    && rm -f /etc/nginx/conf.d/default.conf

COPY --from=builder /src/dist /usr/share/nginx/html

# The nginx user (uid 101) ships with the official image.
USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --spider http://127.0.0.1:8080/ || exit 1

# The inherited entrypoint runs template and ipv6 scripts that expect to be root. This image needs
# neither, so it starts nginx directly.
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
