# production ready dockerfile that runs pnpm start
FROM node:20-alpine

# set working directory
WORKDIR /app

# install pnpm
RUN npm install -g pnpm

# install typescript
RUN npm add -g typescript

# copy package.json
COPY package.json tsconfig.json jest.config.js ./

# copy source code
COPY ./src .

# install dependencies
RUN pnpm fetch
RUN pnpm install

RUN ls

# start app
ENTRYPOINT ["pnpm", "jest"]
