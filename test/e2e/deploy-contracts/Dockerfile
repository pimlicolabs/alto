# production ready dockerfile that runs pnpm start
FROM node:24.22.1-alpine3.24

# set working directory
WORKDIR /app

# install pnpm (pinned to the version used by the repository)
RUN npm install -g --ignore-scripts pnpm@8.15.4

# copy everything
COPY . .

# install dependencies
RUN pnpm fetch
RUN pnpm install --ignore-scripts

# start app
ENTRYPOINT ["pnpm", "run", "start"]
