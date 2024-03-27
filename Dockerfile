# production ready dockerfile that runs pnpm start
FROM node:20-alpine

ARG SENTRY_AUTH_TOKEN

# set working directory
WORKDIR /app

# install pnpm
RUN npm install -g pnpm

# install typescript
RUN npm add -g typescript

# copy package.json and pnpm-lock.yaml
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# copy source code
COPY . .

RUN pnpm fetch

# install dependencies
RUN pnpm install -r

# copy source code
RUN pnpm build

# push sorcemaps to sentry
RUN pnpm sentry:sourcemaps

# remove dev dependencies
RUN pnpm clean-modules

# install dependencies
RUN pnpm install -r --prod

# start app
ENTRYPOINT ["pnpm", "start"]
