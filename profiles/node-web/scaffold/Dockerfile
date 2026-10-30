FROM node:22-slim AS build
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /srv
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY package.json ./
COPY --from=build /srv/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
