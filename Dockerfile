FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

# Uses the lockfile when present (npm ci), plain install otherwise.
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev --no-audit --no-fund; fi

COPY . .

USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
