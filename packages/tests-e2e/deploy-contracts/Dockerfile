# production ready dockerfile that runs pnpm start
FROM node:20-alpine

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
