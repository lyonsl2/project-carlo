#!/usr/bin/env bash
set -euo pipefail

created_env_file=0

cleanup() {
  if [[ "${created_env_file}" == "1" ]]; then
    rm -f .env
  fi
}
trap cleanup EXIT

if [[ ! -f ".env" && -z "${GEMINI_API_KEY:-}" ]]; then
  echo "Missing credentials: provide .env or GEMINI_API_KEY." >&2
  exit 1
fi

if [[ ! -f ".env" ]]; then
  {
    if [[ -n "${GEMINI_API_KEY:-}" ]]; then
      printf "GEMINI_API_KEY=%s\n" "${GEMINI_API_KEY}"
    fi
  } > .env
  created_env_file=1
fi

if [[ -z "${DISPLAY:-}" ]] && command -v xvfb-run >/dev/null 2>&1; then
  xvfb-run -a pnpm weekly:run
else
  pnpm weekly:run
fi
