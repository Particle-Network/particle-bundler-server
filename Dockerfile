FROM --platform=linux/amd64 node:18.13.0-alpine3.17

RUN yarn config set registry https://registry.npm.taobao.org
RUN yarn --network-timeout 1000000

RUN npm config set registry https://registry.npm.taobao.org

RUN npm install --location=global pm2
RUN pm2 install pm2-logrotate

RUN mkdir -p /data/code/particle-bundler-server
WORKDIR /data/code/particle-bundler-server

COPY ecosystem.config.js /data/code/particle-bundler-server/ecosystem.config.js
COPY package.json /data/code/particle-bundler-server/package.json
RUN yarn install --production=true

COPY .env.debug /data/code/particle-bundler-server/.env.debug
COPY dist /data/code/particle-bundler-server/dist

CMD pm2-runtime ecosystem.config.js --env=$ENVIRONMENT

EXPOSE 3000