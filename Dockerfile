# production-ready Dockerfile that runs pnpm start and has forge available
FROM node:20.12.2-alpine3.19

# set working directory
WORKDIR /app

# install system dependencies for Foundry + pnpm
RUN apk add --no-cache \
    bash \
    curl \
    git \
    build-base \
    openssl-dev \
    procps

# install TypeScript globally
RUN npm add -g typescript

# enable corepack (to get pnpm)
RUN corepack install && corepack enable

# install Foundry (forge + cast)
RUN curl -L https://foundry.paradigm.xyz | bash \
    && ~/.foundry/bin/foundryup \
    # make forge/cast available in all shells
    && echo 'export PATH=$PATH:/root/.foundry/bin' > /etc/profile.d/foundry.sh

# update PATH in this image
ENV PATH="/root/.foundry/bin:${PATH}"

# copy pnpm manifests and lockfiles
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# copy source code
COPY . .

RUN pnpm fetch

# install dependencies
RUN pnpm install -r

# build your app
RUN pnpm build

# (optional) remove dev-deps to slim image
# RUN pnpm clean-modules

# default command
ENTRYPOINT ["pnpm", "start"]
