# Build a standalone gossamer Linux binary in a reproducible container, using
# Node's built-in Single Executable Applications (SEA) — no external base-binary
# downloads.
#
#   # native arch (linux-x64 on an x64 host, linux-arm64 on an arm64 host):
#   docker build -f cmux/Dockerfile --target export -o type=local,dest=cmux/build cmux
#
#   # cross-arch via buildx/QEMU:
#   docker buildx build -f cmux/Dockerfile --platform linux/arm64 \
#       --target export -o type=local,dest=cmux/build cmux
#
# (cmux itself is macOS-only; these Linux binaries run the server/CLI anywhere —
# the `cmux browser` bridge simply no-ops off-platform.)

FROM node:20-bookworm AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build && npm run package && ls -la build

# Carry just the built binary out (use --target export -o type=local,dest=...).
FROM scratch AS export
COPY --from=build /app/build/gossamer-linux-* /
