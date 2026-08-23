FROM node:20-alpine

WORKDIR /app

COPY ont-gateway/package.json ./package.json
COPY ont-gateway/package-lock.json ./package-lock.json
RUN npm install --production

COPY ont-gateway/ ./
COPY mapping/ /mapping/

RUN mkdir -p /app/data

EXPOSE 3001

CMD ["node", "server.js"]
