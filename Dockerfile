# syntax=docker/dockerfile:1
# MTJOB trên Coolify của MT DIGITAL (21/11/2026): một container = API Express + giao diện web + cron (server/src/serve.ts).
# Vercel KHÔNG dùng file này (Vercel build theo vercel.json).

# 1) Build giao diện web (Vite) → web/dist
FROM node:22-alpine AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# 2) Máy chủ: chạy TypeScript bằng tsx (giống `npm start`)
FROM node:22-alpine AS runner
ENV NODE_ENV=production PORT=3000
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY server/ ./
COPY --from=web /app/web/dist /app/web/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node_modules/.bin/tsx", "src/serve.ts"]
