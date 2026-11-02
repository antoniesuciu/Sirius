# The same core as the laptop, plus the built UI for phones (ADR-8, ADR-9).
FROM oven/bun:1.4.4 AS build
WORKDIR /src
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build:core && bun run build:ui

FROM debian:bookworm-slim
# ca-certificates is how the core fetches Cloudflare's signing keys.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/dist/sirius-core /usr/local/bin/sirius-core
COPY --from=build /src/apps/desktop/dist /srv/ui
ENV SIRIUS_MODE=remote SIRIUS_DATA_DIR=/data SIRIUS_UI_DIR=/srv/ui BUN_OPTIONS=--smol
VOLUME /data
EXPOSE 7337
CMD ["sirius-core"]
