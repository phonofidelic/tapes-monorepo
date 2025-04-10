FROM node:18-alpine AS base
RUN corepack enable

FROM base AS builder
WORKDIR /app
# RUN npm install -g turbo
COPY . .
RUN ls -la
RUN npx turbo prune --scope=api --docker

FROM base AS installer
WORKDIR /app
COPY .gitignore .gitignore
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/yarn.lock ./yarn.lock
COPY --from=builder /app/out/full/ .
RUN yarn install
# WORKDIR /app
RUN npm install -g @nestjs/cli turbo
RUN turbo run build --filter=api...

FROM base AS runner
WORKDIR /app
COPY --from=installer /app .
CMD [ "node", "apps/api/dist/main.js" ]