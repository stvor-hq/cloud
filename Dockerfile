FROM oven/bun:1.2.6-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.2.6-alpine
WORKDIR /app
ENV PORT=8787
ENV RELAY_TOKEN=stvor-relay-dev-token
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY src ./src
EXPOSE 8787
CMD ["bun", "src/relay/server.ts"]
