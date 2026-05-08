FROM node:20-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js db.js ecosystem.config.js ./
COPY styles.css landing.html cadastro.html ./
COPY js/ ./js/
COPY views/ ./views/
COPY assets/ ./assets/

RUN mkdir -p /data /app/uploads/tasks

EXPOSE 3000
CMD ["node", "server.js"]
