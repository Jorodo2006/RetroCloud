FROM node:24.14.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json ./api/
COPY agent/package.json ./agent/
COPY web/package.json ./web/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=development
USER node
EXPOSE 3000
CMD ["node", "api/dist/server.js"]
