# ReadyState: self-hosted image. Configure at runtime with env vars (see
# .env.example); the same image runs self-hosted or hosted mode.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && node scripts/local/notices.mjs .next/standalone/node_modules \
    && cp -R .next/static .next/standalone/.next/static \
    && cp -R public .next/standalone/public \
    && cp LICENSE .next/standalone/LICENSE \
    && node scripts/local/inspect.mjs .next/standalone

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S readystate && adduser -S readystate -G readystate
COPY --from=build --chown=readystate:readystate /app/.next/standalone ./
LABEL org.opencontainers.image.source="https://github.com/tescolopio/ReadyState" \
    org.opencontainers.image.licenses="AGPL-3.0-only"
USER readystate
EXPOSE 3000
CMD ["node", "server.js"]
