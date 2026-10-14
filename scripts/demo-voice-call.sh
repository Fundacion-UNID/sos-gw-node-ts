#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UHC_CORE_DIST_INDEX="$SCRIPT_DIR/../../uhc-sdk-core-ts/dist/index.js"

BASE_URL="${BASE_URL:-}"
SUBJECT_PHONE="${SUBJECT_PHONE:-}"
TEST_TASK_FORMAT="${TEST_TASK_FORMAT:-org.hl7.fhir.api}"
AUTH_BEARER="${AUTH_BEARER:-demo-token}"
CONTENT_TYPE="${CONTENT_TYPE:-application/json}"
PHONE_LANGUAGE="${PHONE_LANGUAGE:-${TEST_CALL_LANGUAGE:-es-ES}}"
ASSISTANT_NAME="${ASSISTANT_NAME:-${TEST_ASSISTANT_NAME:-Unid}}"
DTMF_MAX_ATTEMPTS="${DTMF_MAX_ATTEMPTS:-${TEST_DTMF_MAX_ATTEMPTS:-3}}"
TASK_RETRY_INTERVAL_MINUTES="${TASK_RETRY_INTERVAL_MINUTES:-${CALL_RETRY_INTERVAL_MINUTES:-5}}"
TTS_VOICE="${TTS_VOICE:-${CALL_TTS_VOICE:-alice}}"
SCHEDULED_FOR="${SCHEDULED_FOR:-${TEST_SCHEDULED_FOR:-}}"
CALL_TASK_DELAY="${CALL_TASK_DELAY:-${TEST_CALL_TASK_DELAY:-}}"
CALL_USE_DAEMON="${CALL_USE_DAEMON:-${TEST_CALL_USE_DAEMON:-false}}"
CALL_WAIT_SECONDS="${CALL_WAIT_SECONDS:-${TEST_CALL_WAIT_SECONDS:-}}"
CALL_LOG_POLL_SECONDS="${CALL_LOG_POLL_SECONDS:-${TEST_CALL_LOG_POLL_SECONDS:-10}}"
TASK_ID="${TASK_ID:-task-medication-demo-$(date +%s)}"
THID="${THID:-thid-$TASK_ID}"
TASK_BASED_ON="${TASK_BASED_ON:-${TEST_TASK_BASED_ON:-MedicationStatement/tension-pill,MedicationStatement/paracetamol}}"
FOCUS_ID="${FOCUS_ID:-${TASK_BASED_ON%%,*}}"
DISPLAY_LANG_KEY_RAW="${PHONE_LANGUAGE%%-*}"
DISPLAY_LANG_KEY="$(printf '%s' "${DISPLAY_LANG_KEY_RAW:-ES}" | tr '[:lower:]' '[:upper:]')"
DISPLAY_LANG_ENV_KEY="TEST_TASK_BASED_ON_DISPLAYS_${DISPLAY_LANG_KEY}"
DISPLAY_LANG_ENV_VALUE="${!DISPLAY_LANG_ENV_KEY:-}"
TASK_BASED_ON_DISPLAYS="${TASK_BASED_ON_DISPLAYS:-${DISPLAY_LANG_ENV_VALUE:-${TEST_TASK_BASED_ON_DISPLAYS:-Pastilla de tensión,Paracetamol 500mg}}}"
PRIMARY_MEDICATION_DISPLAY="${TASK_BASED_ON_DISPLAYS%%,*}"
MEDICATION_NAME="${MEDICATION_NAME:-$PRIMARY_MEDICATION_DISPLAY}"
TITLE="${TITLE:-🔔 Multi-Medication Reminder: $PRIMARY_MEDICATION_DISPLAY & Others}"
DESCRIPTION="${DESCRIPTION:-You have multiple medications to review.}"
PROMPT="${PROMPT:-}"
AUTHORED_ON="${AUTHORED_ON:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

UHC_DEMO_CONTEXT_JSON="$(
  node --input-type=module -e "import { buildUhcVoiceReminderDemoContext } from 'file://${UHC_CORE_DIST_INDEX}'; process.stdout.write(JSON.stringify(buildUhcVoiceReminderDemoContext()));"
)"

DEMO_TENANT_ID="$(printf '%s' "$UHC_DEMO_CONTEXT_JSON" | jq -r '.tenantId')"
DEMO_JURISDICTION="$(printf '%s' "$UHC_DEMO_CONTEXT_JSON" | jq -r '.jurisdiction')"
DEMO_SECTOR="$(printf '%s' "$UHC_DEMO_CONTEXT_JSON" | jq -r '.sector')"
DEMO_SUBJECT_ID="$(printf '%s' "$UHC_DEMO_CONTEXT_JSON" | jq -r '.subjectId')"
DEMO_OWNER_ID="$(printf '%s' "$UHC_DEMO_CONTEXT_JSON" | jq -r '.ownerId')"
DEMO_SUBJECT_ALIAS="$(printf '%s' "$UHC_DEMO_CONTEXT_JSON" | jq -r '.subjectAlias')"

TENANT_ID="${TENANT_ID:-$DEMO_TENANT_ID}"
JURISDICTION="${JURISDICTION:-$DEMO_JURISDICTION}"
SECTOR="${SECTOR:-$DEMO_SECTOR}"
SUBJECT_ID="${SUBJECT_ID:-$DEMO_SUBJECT_ID}"
OWNER_ID="${OWNER_ID:-$DEMO_OWNER_ID}"
SUBJECT_ALIAS="${SUBJECT_ALIAS:-$DEMO_SUBJECT_ALIAS}"

is_true() {
  local value
  value="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "y" || "$value" == "on" ]]
}

parse_delay_seconds() {
  local raw="${1:-}"
  raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  if [[ -z "$raw" ]]; then
    return 1
  fi
  if [[ "$raw" =~ ^([0-9]+)$ ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "$raw" =~ ^([0-9]+)(s|m|h)$ ]]; then
    local amount="${BASH_REMATCH[1]}"
    local unit="${BASH_REMATCH[2]}"
    case "$unit" in
      s) printf '%s' "$amount" ;;
      m) printf '%s' "$((amount * 60))" ;;
      h) printf '%s' "$((amount * 3600))" ;;
      *) return 1 ;;
    esac
    return 0
  fi
  return 1
}

if [[ -z "$SUBJECT_PHONE" ]]; then
  echo "ERROR: SUBJECT_PHONE is required."
  exit 2
fi

if [[ -z "$BASE_URL" ]]; then
  if command -v curl >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
    BASE_URL="$(curl -fsS http://127.0.0.1:4040/api/tunnels \
      | jq -r '.tunnels[]? | select(.proto=="https") | .public_url' \
      | head -n 1 || true)"
  fi
  if [[ -z "$BASE_URL" ]]; then
    BASE_URL="http://localhost:3000"
    echo "WARN: ngrok URL not detected. Using BASE_URL=$BASE_URL"
    echo "WARN: Twilio cannot reach localhost. Start ngrok and set BASE_URL if using real voice calls."
  else
    echo "INFO: detected ngrok BASE_URL=$BASE_URL"
  fi
fi

if [[ "$BASE_URL" == *"<"* || "$BASE_URL" == *">"* || "$BASE_URL" == *"tu-ngrok"* ]]; then
  echo "ERROR: BASE_URL contains a placeholder. Use your real public URL (example: https://abc123.ngrok-free.app)."
  exit 2
fi

echo "INFO: display language key=$DISPLAY_LANG_KEY source=$DISPLAY_LANG_ENV_KEY"

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl is required"
  exit 2
fi

DELAY_SECONDS=0
if [[ -z "$SCHEDULED_FOR" && -n "$CALL_TASK_DELAY" ]]; then
  if ! DELAY_SECONDS="$(parse_delay_seconds "$CALL_TASK_DELAY")"; then
    echo "ERROR: invalid CALL_TASK_DELAY='$CALL_TASK_DELAY' (use formats like 30s, 1m, 2h, or plain seconds)."
    exit 2
  fi
  SCHEDULED_FOR="$(node -e "const s=Number(process.argv[1]); console.log(new Date(Date.now() + s*1000).toISOString());" "$DELAY_SECONDS")"
  echo "INFO: computed SCHEDULED_FOR from CALL_TASK_DELAY=$CALL_TASK_DELAY -> $SCHEDULED_FOR"
fi

SCHEDULED_CLAIMS=""
if [[ -n "$SCHEDULED_FOR" ]]; then
  SCHEDULED_CLAIMS=$(cat <<JSON
,
              "execution-period-start": "$SCHEDULED_FOR",
              "Task.scheduled-at": "$SCHEDULED_FOR"
JSON
)
fi

LOCAL_PING_URL="${LOCAL_PING_URL:-http://localhost:3000/host/.well-known/ping}"
REMOTE_PING_URL="$BASE_URL/host/.well-known/ping"

echo "[preflight] Checking local API at $LOCAL_PING_URL ..."
rm -f /tmp/unid-local-ping.out /tmp/unid-remote-ping.out
LOCAL_HTTP_CODE=$(curl -sS -o /tmp/unid-local-ping.out -w "%{http_code}" "$LOCAL_PING_URL" || true)
if [[ "$LOCAL_HTTP_CODE" != "200" ]]; then
  echo "ERROR: local API is not responding with 200 (got $LOCAL_HTTP_CODE)."
  echo "HINT: keep 'npm run api:local-demo' running and verify it did not crash."
  if [[ -s /tmp/unid-local-ping.out ]]; then
    echo "DETAIL(local): $(head -c 180 /tmp/unid-local-ping.out)"
  fi
  exit 1
fi

echo "[preflight] Checking public callback URL at $REMOTE_PING_URL ..."
REMOTE_HTTP_CODE=$(curl -sS -o /tmp/unid-remote-ping.out -w "%{http_code}" "$REMOTE_PING_URL" || true)
if [[ "$REMOTE_HTTP_CODE" != "200" ]]; then
  echo "ERROR: BASE_URL is not reachable by Twilio (got $REMOTE_HTTP_CODE)."
  echo "HINT: ensure ngrok is online and forwarding to http://localhost:3000."
  if [[ -s /tmp/unid-remote-ping.out ]]; then
    echo "DETAIL(remote): $(head -c 220 /tmp/unid-remote-ping.out)"
  fi
  exit 1
fi

CREATE_PAYLOAD=$(cat <<JSON
{
  "thid": "$THID",
  "body": {
    "data": [
      {
        "type": "Task",
        "request": { "method": "POST" },
        "resource": {
          "resourceType": "Task",
          "id": "$TASK_ID",
          "description": "$DESCRIPTION",
          "meta": {
            "claims": {
              "@context": "org.hl7.fhir.api",
              "id": "$TASK_ID",
              "status": "scheduled",
              "authored-on": "$AUTHORED_ON",
              "subject": "$SUBJECT_ID",
              "owner": "$OWNER_ID",
              "focus": "$FOCUS_ID",
              "Task.based-on": "$TASK_BASED_ON",
              "based-on-display": "$TASK_BASED_ON_DISPLAYS",
              "channel": "phone",
              "trigger-type": "phone-call",
              "voice-to": "$SUBJECT_PHONE",
              "subject-phone": "$SUBJECT_PHONE",
              "language": "$PHONE_LANGUAGE",
              "max-attempts": "$DTMF_MAX_ATTEMPTS",
              "restriction-repetitions": "$DTMF_MAX_ATTEMPTS",
              "retry-interval-minutes": "$TASK_RETRY_INTERVAL_MINUTES",
              "timing-repeat-offset": "$TASK_RETRY_INTERVAL_MINUTES",
              "subject-display": "$SUBJECT_ALIAS"$SCHEDULED_CLAIMS
            }
          }
        }
      }
    ]
  }
}
JSON
)

if ! node -e 'JSON.parse(process.argv[1])' "$CREATE_PAYLOAD" >/dev/null 2>&1; then
  echo "ERROR: generated CREATE_PAYLOAD is invalid JSON. Dumping payload with line numbers:"
  printf '%s\n' "$CREATE_PAYLOAD" | nl -ba
  exit 1
fi

echo "[1/4] Creating reminder task via canonical Task/_batch at $BASE_URL ..."
CREATE_RESP=$(curl -sS -X POST "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/$TEST_TASK_FORMAT/Task/_batch" \
  -H "Content-Type: $CONTENT_TYPE" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -d "$CREATE_PAYLOAD")

echo "$CREATE_RESP"

if command -v jq >/dev/null 2>&1; then
  SUBMIT_STATUS=$(echo "$CREATE_RESP" | jq -r '.status // empty')
  CREATE_DIAGNOSTIC=$(echo "$CREATE_RESP" | jq -r '.body.issues.issue[0].diagnostics // .issues.issue[0].diagnostics // empty')
else
  SUBMIT_STATUS=""
  CREATE_DIAGNOSTIC=""
fi

if [[ -n "${CREATE_DIAGNOSTIC}" ]]; then
  echo "ERROR: create failed: $CREATE_DIAGNOSTIC"
  if [[ "$CREATE_DIAGNOSTIC" == *"Unsupported Content-Type"* ]]; then
    cat <<'TXT'
HINT:
- demo:    CONTENT_TYPE=application/json
- compat:  CONTENT_TYPE=application/didcomm-plaintext+json and DIDCOMM_PLAIN=true
- strict:  this script is not compatible (strict requires secure form JWE request=<...>)
TXT
  fi
  if [[ "$CREATE_DIAGNOSTIC" == *"Bearer token"* || "$CREATE_DIAGNOSTIC" == *"Missing or invalid Bearer"* ]]; then
    cat <<'TXT'
HINT:
- Use AUTH_BEARER with a valid token for your environment, or
- For local demo only: SECURITY_MODE=demo and DEMO_ALLOW_INSECURE_BEARER=true
TXT
  fi
  exit 1
fi

if [[ "${SUBMIT_STATUS}" != "accepted" ]]; then
  echo "WARN: create response does not expose status=accepted (continuing)."
fi

echo "[2/4] Polling Task/_batch-response for thid=$THID ..."
POLL_PAYLOAD=$(cat <<JSON
{
  "thid": "$THID"
}
JSON
)
POLL_RESP=$(curl -sS -X POST "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/$TEST_TASK_FORMAT/Task/_batch-response" \
  -H "Content-Type: $CONTENT_TYPE" \
  -d "$POLL_PAYLOAD")
echo "$POLL_RESP"

if command -v jq >/dev/null 2>&1; then
  OUTCOME_ERROR=$(echo "$POLL_RESP" | jq -r '.data[0].response.outcome.issue[0].diagnostics // empty')
  if [[ -n "$OUTCOME_ERROR" ]]; then
    echo "ERROR: task creation failed in poll response: $OUTCOME_ERROR"
    exit 1
  fi
fi

if [[ -z "$TASK_ID" ]]; then
  echo "ERROR: TASK_ID is empty"
  exit 1
fi

IFS=',' read -r -a BASED_ON_ITEMS <<< "$TASK_BASED_ON"
IFS=',' read -r -a BASED_ON_DISPLAY_ITEMS <<< "$TASK_BASED_ON_DISPLAYS"

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

if [[ "${#BASED_ON_ITEMS[@]}" -gt 1 ]]; then
  echo "[2b/4] Creating ${#BASED_ON_ITEMS[@]} subtasks linked by part-of=Task/$TASK_ID ..."
  for idx in "${!BASED_ON_ITEMS[@]}"; do
    base_ref="$(trim "${BASED_ON_ITEMS[$idx]}")"
    if [[ -z "$base_ref" ]]; then
      continue
    fi
    display_raw="${BASED_ON_DISPLAY_ITEMS[$idx]:-}"
    display="$(trim "${display_raw:-$base_ref}")"
    sub_id="${TASK_ID}-sub-$((idx + 1))"
    sub_thid="${THID}-sub-$((idx + 1))"

    SUB_CREATE_PAYLOAD=$(cat <<JSON
{
  "thid": "$sub_thid",
  "body": {
    "data": [
      {
        "type": "Task",
        "request": { "method": "POST" },
        "resource": {
          "resourceType": "Task",
          "id": "$sub_id",
          "description": "Reminder item: $display",
          "meta": {
            "claims": {
              "@context": "org.hl7.fhir.api",
              "id": "$sub_id",
              "status": "scheduled",
              "authored-on": "$AUTHORED_ON",
              "subject": "$SUBJECT_ID",
              "owner": "$OWNER_ID",
              "focus": "$base_ref",
              "Task.based-on": "$base_ref",
              "based-on-display": "$display",
              "part-of": "Task/$TASK_ID",
              "channel": "phone",
              "trigger-type": "phone-call",
              "voice-to": "$SUBJECT_PHONE",
              "subject-phone": "$SUBJECT_PHONE",
              "language": "$PHONE_LANGUAGE",
              "subject-display": "$SUBJECT_ALIAS"$SCHEDULED_CLAIMS
            }
          }
        }
      }
    ]
  }
}
JSON
)

    if ! node -e 'JSON.parse(process.argv[1])' "$SUB_CREATE_PAYLOAD" >/dev/null 2>&1; then
      echo "ERROR: generated SUB_CREATE_PAYLOAD is invalid JSON for subtask $sub_id. Dumping payload:"
      printf '%s\n' "$SUB_CREATE_PAYLOAD" | nl -ba
      exit 1
    fi

    SUB_CREATE_RESP=$(curl -sS -X POST "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/$TEST_TASK_FORMAT/Task/_batch" \
      -H "Content-Type: $CONTENT_TYPE" \
      -H "Authorization: Bearer $AUTH_BEARER" \
      -d "$SUB_CREATE_PAYLOAD")
    echo "$SUB_CREATE_RESP"
    SUB_POLL_RESP=$(curl -sS -X POST "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/$TEST_TASK_FORMAT/Task/_batch-response" \
      -H "Content-Type: $CONTENT_TYPE" \
      -d "{\"thid\":\"$sub_thid\"}")
    echo "$SUB_POLL_RESP"
  done
fi

TASK_BASE_URL="$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/$TEST_TASK_FORMAT/Task"
LOGS_URL="$TASK_BASE_URL/_logs?taskId=$TASK_ID"

if is_true "$CALL_USE_DAEMON"; then
  echo "[3/4] Daemon mode enabled: skipping manual _call-start. Task will be picked by daemon."
  if ! is_true "${CALL_REMINDER_DAEMON_ENABLED:-false}"; then
    echo "ERROR: CALL_USE_DAEMON=true but CALL_REMINDER_DAEMON_ENABLED is not true in server env."
    echo "HINT: either set CALL_REMINDER_DAEMON_ENABLED=true and restart api:local-demo,"
    echo "      or set TEST_CALL_USE_DAEMON=false for manual _call-start mode."
    echo "INFO: effective TEST_CALL_USE_DAEMON=${CALL_USE_DAEMON}, CALL_REMINDER_DAEMON_ENABLED=${CALL_REMINDER_DAEMON_ENABLED:-false}"
    exit 1
  fi
  if [[ -z "$CALL_WAIT_SECONDS" ]]; then
    local_wait=$((DELAY_SECONDS + 45))
    if (( local_wait < 60 )); then local_wait=60; fi
    CALL_WAIT_SECONDS="$local_wait"
  fi
  echo "INFO: waiting up to ${CALL_WAIT_SECONDS}s for daemon-triggered call (poll every ${CALL_LOG_POLL_SECONDS}s)..."
  if ! [[ "$CALL_WAIT_SECONDS" =~ ^[0-9]+$ ]]; then
    echo "ERROR: CALL_WAIT_SECONDS must be an integer number of seconds."
    exit 2
  fi
  if ! [[ "$CALL_LOG_POLL_SECONDS" =~ ^[0-9]+$ ]]; then
    echo "ERROR: CALL_LOG_POLL_SECONDS must be an integer number of seconds."
    exit 2
  fi
  if (( CALL_LOG_POLL_SECONDS <= 0 )); then
    echo "ERROR: CALL_LOG_POLL_SECONDS must be > 0."
    exit 2
  fi

  deadline=$(( $(date +%s) + CALL_WAIT_SECONDS ))
  daemon_started=0
  while (( $(date +%s) <= deadline )); do
    LOGS_RESP=$(curl -sS "$LOGS_URL" || true)
    if command -v jq >/dev/null 2>&1; then
      STARTED_COUNT=$(echo "$LOGS_RESP" | jq -r --arg task "$TASK_ID" '
        (
          [.logs[]? | select(.type=="voice-call-started" and (.taskId==$task or (.taskId|startswith($task + "-sub-"))))] | length
        ) +
        (
          [.tasks[]? | select((.id==$task or (.id|startswith($task + "-sub-"))) and (.metadata["voice-call-started-at"] != null))] | length
        )
      ' 2>/dev/null || echo "0")
    else
      STARTED_COUNT="$(printf '%s' "$LOGS_RESP" | grep -c '"type":"voice-call-started"' || true)"
    fi
    if [[ "${STARTED_COUNT:-0}" =~ ^[0-9]+$ ]] && (( STARTED_COUNT > 0 )); then
      daemon_started=1
      echo "INFO: daemon started the call for taskId=$TASK_ID"
      break
    fi
    sleep "$CALL_LOG_POLL_SECONDS"
  done
  if (( daemon_started == 0 )); then
    echo "WARN: daemon did not trigger a call within ${CALL_WAIT_SECONDS}s."
    echo "HINT: verify CALL_REMINDER_DAEMON_ENABLED=true and CALL_REMINDER_DAEMON_POLL_SECONDS in server env."
  fi
else
  echo "[3/4] Starting voice call for taskId=$TASK_ID to $SUBJECT_PHONE ..."
  if [[ -n "$PROMPT" ]]; then
    CALL_PAYLOAD=$(cat <<JSON
{
  "taskId": "$TASK_ID",
  "to": "$SUBJECT_PHONE",
  "prompt": "$PROMPT",
  "language": "$PHONE_LANGUAGE",
  "voice": "$TTS_VOICE",
  "assistantName": "$ASSISTANT_NAME",
  "subjectAlias": "$SUBJECT_ALIAS"
}
JSON
)
  else
    CALL_PAYLOAD=$(cat <<JSON
{
  "taskId": "$TASK_ID",
  "to": "$SUBJECT_PHONE",
  "language": "$PHONE_LANGUAGE",
  "voice": "$TTS_VOICE",
  "assistantName": "$ASSISTANT_NAME",
  "subjectAlias": "$SUBJECT_ALIAS"
}
JSON
)
  fi

  CALL_RESP=$(curl -sS -X POST "$TASK_BASE_URL/_call-start" \
    -H "Content-Type: application/json" \
    -d "$CALL_PAYLOAD")

  echo "$CALL_RESP"
fi

echo "[4/4] Fetching logs ..."
LOGS_RESP=$(curl -sS "$LOGS_URL")
if command -v jq >/dev/null 2>&1; then
  echo "$LOGS_RESP" | jq .
else
  echo "$LOGS_RESP"
fi

echo "DONE: taskId=$TASK_ID"
