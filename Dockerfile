FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY . .
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["sh","-c","node src/scripts/migrate.js && node src/server.js"]
