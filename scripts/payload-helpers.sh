#!/usr/bin/env bash
# Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.

render_example_payload() {
  local fixture_name="$1"
  local overrides_json="${2:-\{\}}"
  TS_NODE_TRANSPILE_ONLY=1 TS_NODE_SKIP_IGNORE=1 TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","allowImportingTsExtensions":true}' \
    node --loader ts-node/esm --experimental-specifier-resolution=node \
    ./scripts/render-example-payload.mts "$fixture_name" "$overrides_json"
}

render_demo_payload() {
  local payload_name="$1"
  TS_NODE_TRANSPILE_ONLY=1 TS_NODE_SKIP_IGNORE=1 TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","allowImportingTsExtensions":true}' \
    node --loader ts-node/esm --experimental-specifier-resolution=node \
    ./scripts/render-demo-communication-medications-ips.mts "$payload_name"
}

render_demo_consentaccess_payload() {
  local payload_name="$1"
  TS_NODE_TRANSPILE_ONLY=1 TS_NODE_SKIP_IGNORE=1 TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","allowImportingTsExtensions":true}' \
    node --loader ts-node/esm --experimental-specifier-resolution=node \
    ./scripts/render-demo-consentaccess-payload.mts "$payload_name"
}

render_demo_smart_access_payload() {
  local payload_name="$1"
  TS_NODE_TRANSPILE_ONLY=1 TS_NODE_SKIP_IGNORE=1 TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","allowImportingTsExtensions":true}' \
    node --loader ts-node/esm --experimental-specifier-resolution=node \
    ./scripts/render-demo-smart-access-payload.mts "$payload_name"
}
