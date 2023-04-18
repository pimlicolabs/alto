# production ready dockerfile that runs yarn start
FROM node:18-alpine

# set working directory
WORKDIR /app

# copy
COPY package.json ./
COPY yarn.lock ./

# install dependencies
RUN yarn install --production

# copy source code
COPY . .

RUN yarn build

# start app
CMD ["yarn", "start"]