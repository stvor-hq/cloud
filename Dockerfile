FROM oven/bun:1.2.6-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.2.6-alpine
WORKDIR /app
ENV PORT=8787
# STVOR_APP_TOKEN must be passed at runtime via environment variables.
# Do NOT hardcode secrets in the image.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY src ./src
RUN mkdir -p /app/data && chown -R bun:bun /app
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e 'fetch("http://localhost:8787/health").then(r=>process.exit(r.ok?0:1))'
USER bun
CMD ["bun", "src/relay/server.ts"]
