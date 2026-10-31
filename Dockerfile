# DocSync AI on Cloud Run. Built and pushed by scripts/ci/deploy.sh; runs Next's standalone server.
# Debian (glibc) rather than Alpine so sharp's prebuilt binaries work as-is.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-slim AS build
WORKDIR /app
ARG APP_BUILD_SHA=dev
ENV APP_BUILD_SHA=$APP_BUILD_SHA NEXT_TELEMETRY_DISABLED=1 CONTAINER_BUILD=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 8080
# Settings: the "<environment>-env" secret, mounted here by Cloud Run (scripts/ci/deploy.sh).
CMD ["node", "--env-file-if-exists=/secrets/app.env", "server.js"]
