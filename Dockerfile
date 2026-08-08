# syntax=docker/dockerfile:1

# One image, not one per package: the api process serves the built launcher itself. Split images
# would need a proxy in front to put them back on one origin, and the session cookie is
# first-party by design.
#
# Every stage shares a base, because `better-sqlite3` is a native module and the binary that ends
# up in the runtime tree has to match the runtime it is loaded into.
#
# Only the runtime stage is architecture-specific. `api/dist` and `web/dist` are javascript and
# every package in the production tree is portable, so the two stages that do work are pinned to
# the builder's own architecture: a second platform then costs a copy of the runtime layers rather
# than an emulated npm install.

ARG NODE_VERSION=24-slim

# ── dependencies ───────────────────────────────────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION} AS deps
WORKDIR /app
ENV NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false NPM_CONFIG_UPDATE_NOTIFIER=false

# Manifests alone, so this layer is rebuilt when a dependency changes rather than when a line of
# source does. `.npmrc` carries legacy-peer-deps, without which `npm ci` refuses to resolve, and
# every workspace manifest is needed because npm reads the tree whole.
COPY package.json package-lock.json .npmrc ./
COPY common/package.json common/
COPY api/package.json api/
COPY web/package.json web/

# Only the api's own tree: `web`'s runtime dependencies are bundled into `web/dist` by vite and
# have no business being installed a second time.
#
# `--ignore-scripts` is what keeps this image free of a toolchain: npm runs `node-gyp rebuild` for
# `better-sqlite3` on a fresh install, which needs python and a compiler, while the package
# already ships a prebuilt binding per platform and picks one when it is required. Nothing else in
# the production tree carries an install script.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts -w @diele/api

# `common` emits declarations and no runtime, so nothing in `api/dist` imports it. Dropping the
# workspace links leaves no symlink pointing at a directory the runtime image does not carry.
RUN rm -rf node_modules/@diele

# ── build ──────────────────────────────────────────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION} AS build
WORKDIR /app
ENV NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package.json package-lock.json .npmrc ./
COPY common/package.json common/
COPY api/package.json api/
COPY web/package.json web/
# Same reason as above, and nothing here needs `better-sqlite3` to be loadable: this stage only
# runs the typescript compiler and vite. The two development packages that do carry an install
# script, esbuild and fsevents, resolve their platform binary at runtime from the optional package
# npm installed beside them.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

COPY . .

# `build-only` rather than the web workspace's `build`, which also runs `vue-tsc` over the test
# files this context deliberately leaves out. Type checking is the CI job's work, and it has
# already run against this tree.
RUN npm run build:common \
 && npm run build:api \
 && npm run build-only -w @diele/web

# ── runtime ────────────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/diele.db \
    TMPDIR=/tmp

# Owned by root and read by node, so the process answering requests cannot rewrite its own code.
COPY --from=deps --chown=root:root /app/node_modules ./node_modules
# Not documentation: it carries `type: module`, without which node reads the build as CommonJS,
# and the `imports` map every `#config.js` specifier resolves through.
COPY --from=build --chown=root:root /app/api/package.json ./api/package.json
COPY --from=build --chown=root:root /app/api/dist ./api/dist
COPY --from=build --chown=root:root /app/web/dist ./web/dist
COPY --chown=root:root LICENSE ./LICENSE

# Before VOLUME, so a fresh volume is seeded from this directory with its ownership. SQLite in WAL
# mode writes `-wal` and `-shm` beside the database, so the directory has to be writable and not
# only the file. `node` is the base image's own uid 1000.
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 3000

# There is no curl and no wget in this image, and adding one to answer a health check would be
# among the largest things in it. `fetch` has been a global for four majors.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/status').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# node directly rather than `npm start`: npm wants a writable cache under $HOME, which a read-only
# root filesystem does not give it, and it would only stand between docker and the SIGTERM handler
# in `server.ts`. The base image's entrypoint execs this, so node is pid 1 and receives the signal.
CMD ["node", "api/dist/server.js"]

# Last, so a new version rebuilds one metadata layer rather than every copy above it.
ARG VERSION=0.0.0-dev
ARG REVISION=unknown
ENV DIELE_VERSION=${VERSION}
LABEL org.opencontainers.image.title="diele" \
      org.opencontainers.image.description="Do more with your new tab page: search, launch and admin for everything you run." \
      org.opencontainers.image.source="https://github.com/bernhardkelm/diele" \
      org.opencontainers.image.url="https://github.com/bernhardkelm/diele#readme" \
      org.opencontainers.image.documentation="https://github.com/bernhardkelm/diele#readme" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.vendor="Bernhard Kelm" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
