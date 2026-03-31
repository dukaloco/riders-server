# Bun + Elysia — production image
# Build: docker build -t riders-server .
# Run:  docker run --env-file .env -p 3000:3000 riders-server

FROM oven/bun:1 AS release
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY index.ts ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "index.ts"]
