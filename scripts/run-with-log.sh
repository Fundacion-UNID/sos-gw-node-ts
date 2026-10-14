#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "" ]]; then
  echo "Usage: $0 <label> <command> [args...]"
  exit 2
fi

label="$1"
shift

if [[ "$#" -eq 0 ]]; then
  echo "Usage: $0 <label> <command> [args...]"
  exit 2
fi

mkdir -p logs
ts="$(date +%Y%m%d%H%M%S)"
safe_label="$(echo "$label" | tr ' /:' '---' | tr -cd '[:alnum:]_.-')"
log_file="logs/${ts}-${safe_label}.log"

echo "[run-with-log] writing to ${log_file}"
"$@" 2>&1 | tee -a "$log_file"
cmd_status=${PIPESTATUS[0]}
exit "$cmd_status"

