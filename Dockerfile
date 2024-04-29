# production ready dockerfile that runs pnpm start
FROM node:20-alpine

ARG SENTRY_AUTH_TOKEN

# set working directory
WORKDIR /app

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
RUN SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN} pnpm build

# remove dev dependencies
# RUN pnpm clean-modules

# install dependencies
# RUN pnpm install -r

# start app
ENTRYPOINT ["pnpm", "start"]
