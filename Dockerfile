# Stage 1: Build Contracts using Foundry and Node/pnpm
FROM ghcr.io/foundry-rs/foundry:v1.1.0 AS builder

WORKDIR /build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* .gitmodules ./

COPY contracts ./contracts

# --- FIX: Switch to root user to install packages ---
USER root
# ----------------------------------------------------

RUN apt-get update && \
    apt-get install -y curl gnupg ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable

RUN pnpm install --frozen-lockfile

RUN pnpm run build:contracts

# ---

# Stage 2: Production Runtime Environment
FROM node:20.12.2-alpine3.19 AS production

WORKDIR /app

RUN npm install -g typescript

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./

RUN corepack enable

COPY . .

COPY --from=builder /build/src/contracts ./src/contracts

RUN pnpm fetch

RUN pnpm install -r --offline --frozen-lockfile

RUN pnpm build

# This is needed for backwards compatibility
# alto.js was previously in /src/lib/cli but is now in /src/esm/cli after changing to ESM
RUN mkdir -p /app/src/lib/cli && ln -sf /app/src/esm/cli/alto.js /app/src/lib/cli/alto.js

ENTRYPOINT ["pnpm", "start"]
