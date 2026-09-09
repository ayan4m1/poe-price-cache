FROM node:lts

COPY . /usr/share/poe-price-cache

WORKDIR /usr/share/poe-price-cache

RUN corepack enable && \
    yarn install --immutable && \
    yarn build

CMD ["npm", "start"]
