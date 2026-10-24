FROM oven/bun:1.2-alpine AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ ./src/

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "src/main.ts"]
