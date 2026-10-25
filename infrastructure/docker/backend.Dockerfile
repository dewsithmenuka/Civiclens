# Build context = repository root (monorepo): docker build -f infrastructure/docker/backend.Dockerfile .
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci
COPY packages/contracts packages/contracts
COPY backend backend
RUN npm run build -w @civiclens/contracts && npm run build -w @civiclens/backend

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
RUN npm prune --omit=dev && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD node -e "fetch('http://localhost:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/backend
CMD ["sh", "-c", "node dist/database/migrate.js && node dist/main.js"]
