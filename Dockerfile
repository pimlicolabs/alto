# production ready dockerfile that runs yarn start
FROM node:18-alpine

# set working directory
WORKDIR /app
RUN apk update && apk add --no-cache g++ make python3 && rm -rf /var/cache/apk/*


COPY package.json yarn.lock ./
COPY . .
RUN yarn install --non-interactive --frozen-lockfile

# copy source code
RUN yarn build
RUN yarn install --non-interactive --frozen-lockfile --production

# start app
ENTRYPOINT ["yarn", "start"]