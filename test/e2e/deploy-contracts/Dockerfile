# production ready dockerfile that runs pnpm start
FROM node:24.22.1-alpine3.24

# set working directory
WORKDIR /app

# install pnpm
RUN npm install -g pnpm

# install typescript
RUN npm add -g typescript

# copy everything
COPY . .

# install dependencies
RUN pnpm fetch
RUN pnpm install

# start app
ENTRYPOINT ["pnpm", "run", "start"]
