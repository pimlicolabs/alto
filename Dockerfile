# Official Node.js image, used as the source of the Node.js binaries for the
# contracts build stage
FROM node:24.22.1-bookworm-slim AS node

# Stage 1: Build Contracts using Foundry and Node/pnpm
FROM ghcr.io/foundry-rs/foundry:v1.1.0 AS builder

WORKDIR /build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* .gitmodules ./

COPY contracts ./contracts

# Switch to root user to install Node.js
USER root

# Copy Node.js and corepack from the official image instead of downloading
# and executing a remote setup script
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/corepack

RUN ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack && \
    corepack enable

RUN pnpm install --frozen-lockfile --ignore-scripts

RUN pnpm run build:contracts

# ---

# Stage 2: Production Runtime Environment
FROM node:24.22.1-alpine3.24 AS production

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./

RUN corepack enable

COPY . .

COPY --from=builder /build/src/contracts ./src/contracts

RUN pnpm fetch

RUN pnpm install -r --offline --frozen-lockfile --ignore-scripts

RUN pnpm build

# This is needed for backwards compatibility
# alto.js was previously in /src/lib/cli but is now in /src/esm/cli after changing to ESM
RUN mkdir -p /app/src/lib/cli && ln -sf /app/src/esm/cli/alto.js /app/src/lib/cli/alto.js

ENTRYPOINT ["pnpm", "start"]
