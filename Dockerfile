# production ready dockerfile that runs pnpm start
FROM node:18-alpine

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

# remove dev dependencies
RUN pnpm clean-modules

# install dependencies
RUN pnpm install -r --prod

# start app
ENTRYPOINT ["pnpm", "start"]
