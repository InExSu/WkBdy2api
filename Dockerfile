# syntax=docker/dockerfile:1

# ---- build stage -----------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vitest.config.ts ./
COPY src ./src
COPY wb_v3config.public.json ./
RUN pnpm typecheck

# ---- production stage -----------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
RUN corepack enable \
  && addgroup -S wkb \
  && adduser -S wkb -G wkb \
  && mkdir -p /app/data \
  && chown -R wkb:wkb /app/data
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --omit=dev && pnpm store prune
COPY --from=build /app/src ./src
COPY --from=build /app/wb_v3config.public.json ./wb_v3config.public.json
COPY tsconfig.json ./
# Run via tsx (dev dependency in build stage); install it for runtime too.
RUN pnpm add tsx@4
USER wkb
# No token in the image: credentials come from env / mounted secret.
ENV NODE_ENV=production WKB2API_HOST=127.0.0.1
EXPOSE 7891
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7891)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "start"]
