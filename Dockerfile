FROM oven/bun:alpine AS base
WORKDIR /app

COPY package.json ./
COPY bun.lock* ./
RUN bun install

COPY tsconfig.json ./
COPY src/ ./src/

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "src/main.ts"]
