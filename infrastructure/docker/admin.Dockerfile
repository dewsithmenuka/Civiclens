# Build context = repository root: docker build -f infrastructure/docker/admin.Dockerfile .
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY backend/package.json backend/
COPY admin/package.json admin/
RUN npm ci
COPY packages/contracts packages/contracts
COPY admin admin
RUN npm run build -w @civiclens/contracts && npm run build -w @civiclens/admin

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/admin/.next/standalone ./
COPY --from=build /app/admin/.next/static ./admin/.next/static
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD node -e "fetch('http://localhost:3001/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "admin/server.js"]