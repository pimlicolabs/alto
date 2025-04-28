# production-ready Dockerfile that runs pnpm start and has forge available
FROM node:20-alpine

# set working directory
WORKDIR /app

# install system deps for Foundry + pnpm
RUN apk add --no-cache \
    bash \
    curl \
    git \
    build-base \
    openssl-dev \
    procps

# install pnpm & TypeScript globally
RUN npm install -g pnpm typescript

# install Foundry (forge + cast)
RUN curl -L https://foundry.paradigm.xyz | bash \
    && ~/.foundry/bin/foundryup \
    # make forge/cast available in all shells
    && echo 'export PATH=/root/.foundry/bin:$PATH' > /etc/profile.d/foundry.sh

# ensure PATH is updated for subsequent layers
ENV PATH="/root/.foundry/bin:${PATH}"

# copy all source files
COPY . .

# install dependencies
RUN pnpm fetch \
    && pnpm install

# default command
ENTRYPOINT ["pnpm", "run", "start"]
