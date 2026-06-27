FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY drizzle ./drizzle
USER bun
EXPOSE 8090
CMD ["bun", "run", "src/index.ts"]
