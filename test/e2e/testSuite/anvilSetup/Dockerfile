# production ready dockerfile that runs pnpm start
FROM oven/bun:1.0.30-alpine

# set working directory
WORKDIR /app

# copy package.json and pnpm-lock.yaml
COPY package.json ./

# install dependencies
RUN bun install

# copy source code
COPY ./anvilSetup ./anvilSetup
COPY ./src ./src

# start app
ENTRYPOINT ["bun", "run", "anvilSetup"]
