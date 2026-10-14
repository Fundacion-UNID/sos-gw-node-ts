#!/usr/bin/env bash
set -euo pipefail

HOST_PORT="${HOST_PORT:-8080}"
CONTAINER_PORT="${CONTAINER_PORT:-3000}"
# Canonical Docker-local runtime profile:
# - prefer `.env.local-network` when present
# - fall back to `.env.demo` so existing local setups keep working
# The long-term naming split is:
# - `.env.demo` / optional private `.enc.local-demo` for direct runtime
# - `.env.local-network` for containerized local smoke
ENV_FILE="${ENV_FILE:-}"
if [[ -z "$ENV_FILE" ]]; then
  if [[ -f "./.env.local-network" ]]; then
    ENV_FILE="./.env.local-network"
  else
    ENV_FILE="./.env.demo"
  fi
fi
CONTAINER_NAME="${CONTAINER_NAME:-gwtemplate}"
IMAGE_NAME="${IMAGE_NAME:-gwtemplate}"
FORCE_RECREATE="${FORCE_RECREATE:-false}"
DOCKER_NETWORK="${DOCKER_NETWORK:-}"

confirm_or_force() {
  local message="$1"
  if [[ "$FORCE_RECREATE" == "true" ]]; then
    return 0
  fi

  if [[ ! -t 0 ]]; then
    echo "Aborting: $message Set FORCE_RECREATE=true for non-interactive runs."
    return 1
  fi

  read -p "$message (y/n): " -n 1 -r
  echo ""
  [[ $REPLY =~ ^[Yy]$ ]]
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: env file not found: $ENV_FILE"
  exit 1
fi

EXISTING_CONTAINER_ID="$(docker ps -aq -f name=^/${CONTAINER_NAME}$)"
RUNNING_CONTAINER_ID="$(docker ps -q -f name=^/${CONTAINER_NAME}$)"

if [ -n "$RUNNING_CONTAINER_ID" ]; then
  confirm_or_force "Container '${CONTAINER_NAME}' is running. Stop and remove it?" || exit 1
  docker stop "$CONTAINER_NAME"
  docker rm "$CONTAINER_NAME"
elif [ -n "$EXISTING_CONTAINER_ID" ]; then
  confirm_or_force "Container '${CONTAINER_NAME}' exists (stopped). Remove it?" || exit 1
  docker rm "$CONTAINER_NAME"
fi

DOCKER_NETWORK_ARGS=()
if [[ -n "$DOCKER_NETWORK" ]]; then
  DOCKER_NETWORK_ARGS=(--network "$DOCKER_NETWORK")
fi

docker run -d \
  --env-file "$ENV_FILE" \
  -p "${HOST_PORT}:${CONTAINER_PORT}" \
  --name "$CONTAINER_NAME" \
  "${DOCKER_NETWORK_ARGS[@]}" \
  "$IMAGE_NAME"
echo "Container '${CONTAINER_NAME}' maps localhost:${HOST_PORT} to container:${CONTAINER_PORT}"
