# production ready dockerfile that runs pnpm start
FROM node:20.12.2-alpine3.19

# set working directory
WORKDIR /app

# 1. Install system deps (curl, git, build tools)
RUN apk add --no-cache curl git build-base

# 2. Bootstrap Foundry with the official installer
RUN curl -L https://foundry.paradigm.xyz | bash \
    && foundryup               \
    && rm -rf /var/cache/apk/*

# 3. Make sure forge/cast are on PATH
ENV PATH="/root/.foundry/bin:${PATH}"

# install typescript
RUN npm add -g typescript

# copy package.json and pnpm-lock.yaml
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# install pnpm and create global pnpm symlink
RUN corepack install && corepack enable

# copy source code
COPY . .

RUN pnpm fetch

# install dependencies
RUN pnpm install -r

# copy source code
RUN pnpm build

# remove dev dependencies
# RUN pnpm clean-modules

# install dependencies
# RUN pnpm install -r

# start app
ENTRYPOINT ["pnpm", "start"]
