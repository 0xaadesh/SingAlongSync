# SingAlongSync web app (Next.js), built and served with Bun.
FROM oven/bun:1.3.14 AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
# The /api, /downloads and /media proxy to the backend is fixed at build time
ARG API_PROXY_TARGET=http://server:8000
ENV API_PROXY_TARGET=$API_PROXY_TARGET
RUN bun run build

FROM oven/bun:1.3.14
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./
EXPOSE 3000
CMD ["bun", "run", "start"]
