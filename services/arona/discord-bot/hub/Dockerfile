FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY web/dist ./web/dist
CMD ["bun", "run", "src/main.ts"]
