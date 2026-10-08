# Deployment template only; not built or deployed during local prototype work.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY src ./src
COPY scripts/build-network.mjs ./scripts/build-network.mjs
RUN node scripts/build-network.mjs && npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 PUBLIC_ORIGIN=http://127.0.0.1:4173 SPELLWOOD_DATABASE=/app/.data/spellwood.sqlite
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/client-dist ./client-dist
COPY server ./server
COPY src ./src
COPY dist/assets ./dist/assets
RUN mkdir -p /app/.data && chown node:node /app/.data
VOLUME ["/app/.data"]
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "server/healthcheck.mjs"]
CMD ["node", "server/index.mjs"]
