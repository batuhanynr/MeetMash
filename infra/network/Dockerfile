FROM node:26-alpine
RUN apk add --no-cache iproute2 iproute2-tc openssl
WORKDIR /lab
COPY package*.json ./
COPY apps/agent-node/package.json apps/agent-node/
COPY apps/hub/package.json apps/hub/
COPY packages/protocol/package.json packages/protocol/
COPY packages/runtime/package.json packages/runtime/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY apps/agent-node apps/agent-node
COPY apps/hub apps/hub
COPY packages packages
COPY infra/local/schema.sql infra/local/schema.sql
COPY infra/network infra/network
COPY scripts scripts
CMD ["sleep", "infinity"]
