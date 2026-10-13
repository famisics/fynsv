FROM oven/bun:1
WORKDIR /app
ENV NODE_ENV=production
# vite build の出力は依存を同梱するので、node_modules は要らない
COPY .output ./.output
CMD ["bun", ".output/server/index.mjs"]
