# syntax=docker/dockerfile:1.7
FROM node:24.13.0-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN PORT=5173 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/clean-core build \
 && NODE_ENV=production pnpm --filter @workspace/api-server build \
 && pnpm --filter @workspace/api-server deploy --legacy --prod /runtime
# Only compiled server code and production dependencies enter the runtime.
RUN rm -rf /runtime/src /runtime/scripts /runtime/.replit-artifact \
 && find /runtime -name '*.map' -delete

FROM node:24.13.0-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8080 CC_STATIC_DIR=/app/public CC_SCHEMA_BOOTSTRAP=false
WORKDIR /app
COPY --from=build /runtime/node_modules ./node_modules
COPY --from=build /workspace/artifacts/api-server/dist ./dist
COPY --from=build /workspace/artifacts/clean-core/dist/public ./public
RUN mkdir -p /data && chown 1000:0 /data && chmod 0770 /data \
 && chmod -R a+rX /app
USER 1000:0
EXPOSE 8080
STOPSIGNAL SIGTERM
CMD ["node", "dist/index.mjs"]
