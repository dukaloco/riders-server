# riders-server

Dukaloco Riders API — Bun, Elysia, MongoDB, Redis.

## Local setup

```bash
bun install
cp .env.example .env   # fill in secrets
bun run dev
```

## Docker

```bash
docker build -t riders-server .
docker run --env-file .env -p 3000:3000 riders-server
```

Built with [Bun](https://bun.sh).
