#!/usr/bin/env bash
# Runs the note repository contract suite against both implementations, the in memory reference and
# the DynamoDB adapter, in Python and in TypeScript, with the DynamoDB side pointed at DynamoDB
# Local. This is the executable EEP-ARCH-02 proof: it fails if either implementation in either
# language diverges from the one contract.
#
# By default it brings DynamoDB Local up from the pinned compose file and tears it down afterwards.
# If DYNAMODB_ENDPOINT_URL is already set, it runs against that endpoint and manages no container, so
# a Local started another way (a jar on a host with no Docker daemon, a shared container in CI) is
# used as is.
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
  echo "Starting DynamoDB Local from $COMPOSE_FILE"
  docker compose -f "$COMPOSE_FILE" up -d --wait
  STARTED_COMPOSE=1
  export DYNAMODB_ENDPOINT_URL="http://localhost:8000"
fi

echo "Endpoint: $DYNAMODB_ENDPOINT_URL"

echo "Running the Python contract suite against both implementations"
python -m pytest wiring/python -q

echo "Running the TypeScript contract suite against both implementations"
npm run test:contract

echo "Contract suite passed against every implementation"
