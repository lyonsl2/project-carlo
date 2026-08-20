#!/usr/bin/env bash
#
# Runs the pgTAP suite in supabase/tests against a plain PostgreSQL server.
#
# `supabase test db` is the normal way to run these, but it needs Docker. This
# script gets the same coverage from a local PostgreSQL with the pgtap extension
# by first applying scripts/plain-postgres-shim.sql, which recreates the parts of
# a Supabase database the migrations rely on (the API roles, the auth schema,
# auth.uid(), and Supabase's default privileges on public).
#
# Usage:
#   scripts/db-test-local.sh                       # creates a scratch database
#   DATABASE_URL=postgres://... scripts/db-test-local.sh
#
# Requires: psql and the pgtap extension (postgresql-<version>-pgtap).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHIM="${REPO_ROOT}/scripts/plain-postgres-shim.sql"
MIGRATIONS_DIR="${REPO_ROOT}/supabase/migrations"
TESTS_DIR="${REPO_ROOT}/supabase/tests"
SCRATCH_DB="${SCRATCH_DB:-project_carlo_rls_test}"

# `drop trigger if exists` and friends are chatty on a fresh database and the
# notices drown out the TAP output.
PG_OPTS="-c client_min_messages=warning"

if [[ -n "${DATABASE_URL:-}" ]]; then
  ADMIN_PSQL=(env "PGOPTIONS=${PG_OPTS}" psql "${DATABASE_URL}")
  PSQL=("${ADMIN_PSQL[@]}")
else
  # No connection string: build a throwaway database over the local socket.
  # `sudo -u postgres` is how a Debian/Ubuntu postgres install expects to be
  # driven when no role matches the current user.
  ADMIN_PSQL=(sudo -u postgres env "PGOPTIONS=${PG_OPTS}" psql)
  if ! "${ADMIN_PSQL[@]}" -qtAc 'select 1' >/dev/null 2>&1; then
    ADMIN_PSQL=(env "PGOPTIONS=${PG_OPTS}" psql -U postgres)
  fi
  "${ADMIN_PSQL[@]}" -qtAc "drop database if exists ${SCRATCH_DB}" >/dev/null
  "${ADMIN_PSQL[@]}" -qtAc "create database ${SCRATCH_DB}" >/dev/null
  PSQL=("${ADMIN_PSQL[@]}" -d "${SCRATCH_DB}")
  cleanup() {
    "${ADMIN_PSQL[@]}" -qtAc "drop database if exists ${SCRATCH_DB}" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT
fi

echo "==> Applying Supabase shim"
"${PSQL[@]}" -v ON_ERROR_STOP=1 --quiet --no-psqlrc -f "${SHIM}" >/dev/null

echo "==> Applying migrations"
for migration in "${MIGRATIONS_DIR}"/*.sql; do
  echo "    $(basename "${migration}")"
  "${PSQL[@]}" -v ON_ERROR_STOP=1 --quiet --no-psqlrc -f "${migration}" >/dev/null
done

echo "==> Running pgTAP suite"
status=0
for test_file in "${TESTS_DIR}"/*.sql; do
  echo "--- $(basename "${test_file}")"
  output=$("${PSQL[@]}" -v ON_ERROR_STOP=1 --quiet --no-psqlrc \
    --no-align --tuples-only -f "${test_file}" 2>&1) || status=1
  echo "${output}"
  # psql exits 0 on a failed assertion, so the TAP stream is the real verdict.
  if grep -qE '^not ok|^# Looks like' <<<"${output}"; then
    status=1
  fi
done

if [[ ${status} -ne 0 ]]; then
  echo "==> FAILED"
  exit 1
fi

echo "==> PASSED"
