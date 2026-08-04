#!/usr/bin/env bash
# Runs the note repository contract suite against both implementations, the in memory reference and
# the DynamoDB adapter, in Python and in TypeScript, with the DynamoDB side pointed at DynamoDB
# Local. This is the executable EEP-ARCH-02 proof: it fails if either implementation in either
# language diverges from the one contract.
#
# By default it brings DynamoDB Local up from the pinned compose file and tears it down afterwards.
# If DYNAMODB_ENDPOINT_URL is already set, it runs against that endpoint and manages no container, so
# a Local started another way (a jar on a host with no Docker daemon, a shared container in CI) is
# used as is. If neither is available, that is, no endpoint is set and Docker is not running, it
# skips loudly and exits zero, so a first `eep verify` on a machine without Docker still passes; the
# suite runs in full wherever Docker or an endpoint exists, including CI.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

export NOTES_TABLE_NAME="${NOTES_TABLE_NAME:-notes-contract}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-local}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-local}"

COMPOSE_FILE="local/docker-compose.dynamodb-local.yaml"
STARTED_COMPOSE=0

cleanup() {
  if [ "$STARTED_COMPOSE" = "1" ]; then
    docker compose -f "$COMPOSE_FILE" down >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [ -z "${DYNAMODB_ENDPOINT_URL:-}" ]; then
  if ! docker info >/dev/null 2>&1; then
    echo "SKIP: Docker is not available, so DynamoDB Local cannot start here. The contract suite"
    echo "runs wherever Docker or a DYNAMODB_ENDPOINT_URL exists, including CI; set that variable"
    echo "to run it against a DynamoDB Local started another way."
    exit 0
  fi
  echo "Starting DynamoDB Local from $COMPOSE_FILE"
  # Clear any container a previous run left behind when it was interrupted before its cleanup ran,
  # so a stale one does not hold the port and fail the fresh start.
  docker compose -f "$COMPOSE_FILE" down >/dev/null 2>&1 || true
  docker compose -f "$COMPOSE_FILE" up -d --wait
  STARTED_COMPOSE=1
  export DYNAMODB_ENDPOINT_URL="http://localhost:8000"
fi

echo "Endpoint: $DYNAMODB_ENDPOINT_URL"

echo "Running the Python contract suite against both implementations"
(cd wiring/python && uv run --all-extras pytest . -q)

echo "Running the TypeScript contract suite against both implementations"
npm run test:contract

echo "Contract suite passed against every implementation"
