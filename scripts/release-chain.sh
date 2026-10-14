#!/usr/bin/env bash
set -euo pipefail

BUMP_TYPE="${1:-patch}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_DIR="$(cd "${ROOT_DIR}/.." && pwd)"
COMMON_UTILS_DIR="${WORKSPACE_DIR}/gdc-common-utils-ts"
SDK_DIR="${WORKSPACE_DIR}/gdc-sdk-client-ts"
APP_DIR="${ROOT_DIR}"

if [[ ! -d "${COMMON_UTILS_DIR}" ]]; then
  echo "Missing repo: ${COMMON_UTILS_DIR}" >&2
  exit 1
fi
if [[ ! -d "${SDK_DIR}" ]]; then
  echo "Missing repo: ${SDK_DIR}" >&2
  exit 1
fi

echo "==> Bumping gdc-common-utils-ts (${BUMP_TYPE})"
pushd "${COMMON_UTILS_DIR}" >/dev/null
npm version "${BUMP_TYPE}" --no-git-tag-version
npm run build
COMMON_VERSION="$(node -p "require('./package.json').version")"
npm publish
popd >/dev/null

echo "==> Bumping gdc-sdk-client-ts (${BUMP_TYPE})"
pushd "${SDK_DIR}" >/dev/null
npm version "${BUMP_TYPE}" --no-git-tag-version
npm install "gdc-common-utils-ts@${COMMON_VERSION}"
npm run build
SDK_VERSION="$(node -p "require('./package.json').version")"
npm publish
popd >/dev/null

echo "==> Bumping gwtemplate-node-ts (${BUMP_TYPE})"
pushd "${APP_DIR}" >/dev/null
npm version "${BUMP_TYPE}" --no-git-tag-version
npm install "gdc-common-utils-ts@${COMMON_VERSION}" "gdc-sdk-client-ts@${SDK_VERSION}"
popd >/dev/null

echo "Done:"
echo "  gdc-common-utils-ts@${COMMON_VERSION}"
echo "  gdc-sdk-client-ts@${SDK_VERSION}"
