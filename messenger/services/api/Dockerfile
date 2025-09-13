FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

ENV NODE_ENV=production

RUN npm run build

EXPOSE 4000
CMD ["npm", "start"]