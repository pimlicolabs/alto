# production ready dockerfile that runs pnpm start
FROM node:20-alpine

# set working directory
WORKDIR /app

COPY package.json ./

# install pnpm
RUN corepack install && corepack enable

# install typescript
RUN npm add -g typescript

# copy package.json
COPY package.json tsconfig.json ./

# copy source code
COPY ./anvilSetup ./anvilSetup
COPY ./src ./src

# install dependencies
RUN pnpm fetch
RUN pnpm install

RUN ls

# start app
#ENTRYPOINT ["pnpm", "run", "anvilSetup"]
ENTRYPOINT ["pnpm", "run", "anvilSetup"]
