FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm install --no-save tsx
COPY --from=build /app/dist ./dist
COPY scripts ./scripts
COPY src ./src
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
