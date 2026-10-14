set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_TOKEN_FILE=""
LOCAL_IMAGE_NAME="${LOCAL_IMAGE_NAME:-gwtemplate}"
DOCKER_PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"
# Token discovery intentionally follows the same local profile naming family
# that operators will keep using during the migration away from generic files.
# Preference order:
# 1. `.env.local-network` for containerized local smoke
# 2. `.env.demo` for direct local runtime
# 3. repo-specific local/cloud variants kept for backwards compatibility
for candidate in ".env.local-network" ".env.demo" ".env.local-postgres" ".env.cloud-supabase"; do
  if [[ -f "$SCRIPT_DIR/$candidate" ]]; then
    ENV_TOKEN_FILE="$SCRIPT_DIR/$candidate"
    break
  fi
done
NPM_TOKEN_VALUE=""
if [[ -n "$ENV_TOKEN_FILE" ]]; then
  NPM_TOKEN_VALUE="$(grep NPM_TOKEN "$ENV_TOKEN_FILE" | cut -d '=' -f2)"
fi
if [[ "$NPM_TOKEN_VALUE" == "your-npm-token" || "$NPM_TOKEN_VALUE" == "replace-me" ]]; then
  NPM_TOKEN_VALUE=""
fi
FORCE_NO_CACHE=false
CACHE_MARKER="$SCRIPT_DIR/.docker-build-deps.sha256"

if [[ "${1:-}" == "--no-cache" || "${1:-}" == "-n" ]]; then
  FORCE_NO_CACHE=true
fi

hash_deps() {
  local pkg="$SCRIPT_DIR/package.json"
  local lock="$SCRIPT_DIR/package-lock.json"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$pkg" "$lock"
  else
    sha256sum "$pkg" "$lock"
  fi
}

echo "Checking prerequisites..."
if ! docker info > /dev/null 2>&1; then
  echo "ERROR: Docker is not running."
  exit 1
fi
echo "Docker is running."

DEPS_HASH="$(hash_deps | awk '{print $1}' | paste -sd ' ' -)"
if [[ ! -f "$CACHE_MARKER" ]]; then
  FORCE_NO_CACHE=true
else
  CACHED_HASH="$(cat "$CACHE_MARKER")"
  if [[ "$DEPS_HASH" != "$CACHED_HASH" ]]; then
    FORCE_NO_CACHE=true
  fi
fi

echo "Running local TypeScript check (tsc --noEmit)..."
(
  cd "$SCRIPT_DIR" || exit 1
  npx tsc --noEmit
)

echo "Building Docker image..."
echo "Image: ${LOCAL_IMAGE_NAME}"
echo "Platform: ${DOCKER_PLATFORM}"
echo "Context: ${SCRIPT_DIR}"
if [[ "$FORCE_NO_CACHE" == "true" ]]; then
  echo "Using --no-cache (dependency changes detected or flag provided)."
  NO_CACHE_FLAG="--no-cache"
else
  NO_CACHE_FLAG=""
fi

if [ -n "$NPM_TOKEN_VALUE" ]; then
  docker build \
    $NO_CACHE_FLAG \
    --platform "$DOCKER_PLATFORM" \
    --build-arg NPM_TOKEN="$NPM_TOKEN_VALUE" \
    -t "$LOCAL_IMAGE_NAME" \
    -f "$SCRIPT_DIR/Dockerfile" \
    "$SCRIPT_DIR"
else
  docker build \
    $NO_CACHE_FLAG \
    --platform "$DOCKER_PLATFORM" \
    -t "$LOCAL_IMAGE_NAME" \
    -f "$SCRIPT_DIR/Dockerfile" \
    "$SCRIPT_DIR"
fi

echo "$DEPS_HASH" > "$CACHE_MARKER"
echo "Built ${LOCAL_IMAGE_NAME} for ${DOCKER_PLATFORM}."
