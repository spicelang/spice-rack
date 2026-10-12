# syntax=docker/dockerfile:1

# ---- Stage 1: compile the application logic (Spice) to WebAssembly --------------------------------------------------
FROM debian:bookworm-slim AS wasm
ARG SPICE_VERSION=0.29.0
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl clang lld \
 && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /opt/spice \
 && curl -fsSL "https://github.com/spicelang/spice/releases/download/${SPICE_VERSION}/spice_linux_${TARGETARCH}.tar.gz" \
  | tar -xz -C /opt/spice
ENV SPICE=/opt/spice/spice \
    SPICE_STD_DIR=/opt/spice/std
WORKDIR /src
COPY src ./src
COPY scripts/build-wasm.sh ./scripts/build-wasm.sh
RUN ./scripts/build-wasm.sh /out/rack.wasm

# ---- Stage 2: Node.js host (HTTP, MySQL, GitHub calls) + the wasm module ----------------------------------------------
FROM node:26-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    WASM_PATH=/app/rack.wasm \
    PUBLIC_DIR=/app/public \
    MIGRATIONS_DIR=/app/db/migrations
WORKDIR /app/host
COPY host/package.json host/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY host/*.mjs ./
COPY public /app/public
COPY db/migrations /app/db/migrations
COPY --from=wasm /out/rack.wasm /app/rack.wasm
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
