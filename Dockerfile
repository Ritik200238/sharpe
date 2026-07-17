# SHARPE agent — the always-on half (the frontend deploys to Vercel separately).
# Build:  docker build -t sharpe-agent .
# Run:    docker run -d --name sharpe -p 8787:8787 \
#           -v sharpe-keys:/app/_keys -v sharpe-data:/app/data sharpe-agent
# The recorder can run in the same image: override the command with
#   npx tsx services/recorder/src/bootstrap.ts

FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY services/agent/package.json services/agent/
COPY services/recorder/package.json services/recorder/
RUN npm ci --omit=dev --no-fund --no-audit && npm install -g tsx@4

COPY services ./services

# Track record + recordings live on mounted volumes so restarts lose nothing.
VOLUME ["/app/_keys", "/app/data"]

EXPOSE 8787
ENV TX_NETWORK=devnet API_PORT=8787

CMD ["tsx", "services/agent/src/main.ts", "--network", "devnet", "--mode", "live", "--exec", "paper", "--port", "8787"]
