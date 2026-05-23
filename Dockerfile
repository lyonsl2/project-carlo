FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_VERSION=22

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg git xvfb \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_VERSION}.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && corepack enable \
    && corepack prepare pnpm@10.12.1 --activate \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Copy lockfiles and package manifests first for better dependency caching.
COPY pyproject.toml uv.lock ./
COPY README.md ./
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json

RUN uv sync --frozen --group dev --no-install-project
RUN uv run playwright install --with-deps chromium
RUN pnpm install --frozen-lockfile

# Copy repository sources after dependency install layers.
COPY . .

RUN uv sync --frozen --group dev

CMD ["bash", "docker/weekly-run.sh"]
