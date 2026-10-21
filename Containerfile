FROM node:24-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/pos/package.json apps/pos/package.json
COPY apps/print-agent/package.json apps/print-agent/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN pnpm install --frozen-lockfile

COPY apps apps
COPY packages packages

ENV VITE_REMOTE_MODE=true
ENV VITE_API_URL=/api
ENV VITE_APP_MODE=pos
RUN pnpm build
RUN pnpm --filter @antojit-os/api deploy --prod --legacy /output/api
RUN pnpm --filter @antojit-os/print-agent deploy --prod --legacy /output/print-agent
RUN rm -rf /output/api/dist /output/print-agent/dist \
  && cp -R /workspace/apps/api/dist /output/api/dist \
  && cp -R /workspace/apps/print-agent/dist /output/print-agent/dist

FROM node:24-alpine AS api

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /output/api ./
EXPOSE 3000
CMD ["sh", "-c", "node dist/database/migrate.js && exec node dist/main.js"]

FROM nginx:1.29-alpine AS web

ENV NGINX_ENVSUBST_FILTER=CONTAINER_DNS_RESOLVER
COPY deploy/15-container-resolver.envsh /docker-entrypoint.d/15-container-resolver.envsh
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /workspace/apps/pos/dist /usr/share/nginx/html
RUN chmod 755 /docker-entrypoint.d/15-container-resolver.envsh
EXPOSE 80

FROM node:24-alpine AS print-agent

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /output/print-agent ./
CMD ["node", "dist/main.js"]
