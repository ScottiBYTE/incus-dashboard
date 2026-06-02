FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache incus-client

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 80

CMD ["node", "server.js"]

