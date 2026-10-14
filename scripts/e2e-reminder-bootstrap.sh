#!/usr/bin/env bash
set -euo pipefail

# End-to-end reminder bootstrap:
# 1) (optional) tenant onboarding on host registry
# 2) create subject (Person) in tenant individual vault (with phone)
# 3) create reminder Task (+ subtasks) WITHOUT voice-to metadata
# 4) wait daemon call trigger and print logs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UHC_CORE_DIST_INDEX="$SCRIPT_DIR/../../uhc-sdk-core-ts/dist/index.js"

BASE_URL="${BASE_URL:-http://localhost:3300}"
AUTH_BEARER="${AUTH_BEARER:-demo-token}"
CONTENT_TYPE="${CONTENT_TYPE:-application/json}"
TEST_TASK_FORMAT="${TEST_TASK_FORMAT:-org.hl7.fhir.api}"

UHC_DEMO_CONTEXT_JSON="$(
  node --input-type=module -e "import { buildUhcVoiceReminderDemoContext } from 'file://${UHC_CORE_DIST_INDEX}'; process.stdout.write(JSON.stringify(buildUhcVoiceReminderDemoContext()));"
)"

DEMO_TENANT_ID="$(printf '%s' "$UHC_DEMO_CONTEXT_JSON" | jq -r '.tenantId')"
DEMO_JURISDICTION="$(printf '%s' "$UHC_DEMO_CONTEXT_JSON" | jq -r '.jurisdiction')"
DEMO_SECTOR="$(printf '%s' "$UHC_DEMO_CONTEXT_JSON" | jq -r '.sector')"
DEMO_HOST_REGISTRY_NETWORK="$(printf '%s' "$UHC_DEMO_CONTEXT_JSON" | jq -r '.hostRegistryNetwork')"
DEMO_SUBJECT_ID="$(printf '%s' "$UHC_DEMO_CONTEXT_JSON" | jq -r '.subjectId')"
DEMO_SUBJECT_ALIAS="$(printf '%s' "$UHC_DEMO_CONTEXT_JSON" | jq -r '.subjectAlias')"
DEMO_SUBJECT_EMAIL="$(printf '%s' "$UHC_DEMO_CONTEXT_JSON" | jq -r '.subjectEmail')"
DEMO_SUBJECT_IDENTIFIER_TYPE="$(printf '%s' "$UHC_DEMO_CONTEXT_JSON" | jq -r '.subjectIdentifierType')"
DEMO_SUBJECT_IDENTIFIER_VALUE="$(printf '%s' "$UHC_DEMO_CONTEXT_JSON" | jq -r '.subjectIdentifierValue')"
DEMO_OWNER_ID="$(printf '%s' "$UHC_DEMO_CONTEXT_JSON" | jq -r '.ownerId')"
DEMO_CONTROLLER_EMAIL="$(printf '%s' "$UHC_DEMO_CONTEXT_JSON" | jq -r '.controllerEmail // empty')"

JURISDICTION="${JURISDICTION:-$DEMO_JURISDICTION}"
TENANT_ID="${TENANT_ID:-$DEMO_TENANT_ID}"
SECTOR="${SECTOR:-$DEMO_SECTOR}"
HOST_REGISTRY_NETWORK="${HOST_REGISTRY_NETWORK:-$DEMO_HOST_REGISTRY_NETWORK}"

ENSURE_TENANT="${ENSURE_TENANT:-true}"

SUBJECT_PHONE="${SUBJECT_PHONE:-}"
SUBJECT_ALIAS="${SUBJECT_ALIAS:-$DEMO_SUBJECT_ALIAS}"
SUBJECT_ID="${SUBJECT_ID:-$DEMO_SUBJECT_ID}"
SUBJECT_EMAIL="${SUBJECT_EMAIL:-$DEMO_SUBJECT_EMAIL}"
SUBJECT_IDENTIFIER_TYPE="${SUBJECT_IDENTIFIER_TYPE:-$DEMO_SUBJECT_IDENTIFIER_TYPE}"
SUBJECT_IDENTIFIER_VALUE="${SUBJECT_IDENTIFIER_VALUE:-$DEMO_SUBJECT_IDENTIFIER_VALUE}"

OWNER_ID="${OWNER_ID:-$DEMO_OWNER_ID}"
CONTROLLER_EMAIL="${TEST_INDIVIDUAL_CONTROLLER_EMAIL:-${CONTROLLER_EMAIL:-$DEMO_CONTROLLER_EMAIL}}"
PHONE_LANGUAGE="${TEST_CALL_LANGUAGE:-${PHONE_LANGUAGE:-${CALL_DEFAULT_LOCALE:-es-ES}}}"
MAX_ATTEMPTS="${TEST_TASK_MAX_ATTEMPTS:-${MAX_ATTEMPTS:-${CALL_MAX_ATTEMPTS:-3}}}"
RETRY_INTERVAL_MINUTES="${TEST_TASK_TIMING_REPEAT_OFFSET:-${RETRY_INTERVAL_MINUTES:-${CALL_RETRY_INTERVAL_MINUTES:-1}}}"
CALL_TASK_DELAY="${TEST_CALL_TASK_DELAY:-${CALL_TASK_DELAY:-15s}}"
WAIT_SECONDS="${TEST_CALL_WAIT_SECONDS:-${WAIT_SECONDS:-90}}"
WAIT_POLL_SECONDS="${TEST_CALL_WAIT_POLL_SECONDS:-${WAIT_POLL_SECONDS:-5}}"
LOG_DIR="${LOG_DIR:-./logs/e2e-reminder-bootstrap}"

TASK_BASED_ON="${TASK_BASED_ON:-${TEST_TASK_BASED_ON:-MedicationStatement/tension-pill,MedicationStatement/paracetamol}}"
DISPLAY_LANG_KEY_RAW="${PHONE_LANGUAGE%%-*}"
DISPLAY_LANG_KEY="$(printf '%s' "${DISPLAY_LANG_KEY_RAW:-ES}" | tr '[:lower:]' '[:upper:]')"
DISPLAY_LANG_ENV_KEY="TEST_TASK_BASED_ON_DISPLAYS_${DISPLAY_LANG_KEY}"
DISPLAY_LANG_ENV_VALUE="${!DISPLAY_LANG_ENV_KEY:-}"
TASK_BASED_ON_DISPLAYS="${TASK_BASED_ON_DISPLAYS:-${DISPLAY_LANG_ENV_VALUE:-${TEST_TASK_BASED_ON_DISPLAYS:-Pastilla de tensión,Paracetamol 500mg}}}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing command '$1'"; exit 2; }
}

require_cmd curl
require_cmd jq
require_cmd node

if [[ -z "$SUBJECT_PHONE" ]]; then
  echo "ERROR: SUBJECT_PHONE is required (E.164, e.g. +12025550104)."
  exit 2
fi

is_true() {
  local value
  value="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "y" || "$value" == "on" ]]
}

parse_delay_seconds() {
  local raw="${1:-}"
  raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
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

DELAY_SECONDS="$(parse_delay_seconds "$CALL_TASK_DELAY")"
SCHEDULED_FOR="$(node -e "const s=Number(process.argv[1]); console.log(new Date(Date.now()+s*1000).toISOString())" "$DELAY_SECONDS")"
TASK_ID="task-e2e-$(date +%s)"
THID_TASK="thid-$TASK_ID"
RUN_TS="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/e2e-reminder-bootstrap_${RUN_TS}.log"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "INFO: script log file: $LOG_FILE"
echo "INFO: effective retry config maxAttempts=$MAX_ATTEMPTS retryIntervalMinutes=$RETRY_INTERVAL_MINUTES delay=$CALL_TASK_DELAY waitSeconds=$WAIT_SECONDS"
echo "INFO: display language key=$DISPLAY_LANG_KEY source=$DISPLAY_LANG_ENV_KEY"
if [[ -n "$CONTROLLER_EMAIL" ]]; then
  echo "INFO: controller summary email destination: $CONTROLLER_EMAIL"
else
  echo "WARN: no TEST_INDIVIDUAL_CONTROLLER_EMAIL/CONTROLLER_EMAIL set; summary email dispatch will be skipped."
fi

http_post_json() {
  local url="$1"
  local payload="$2"
  curl -sS -X POST "$url" \
    -H "Content-Type: $CONTENT_TYPE" \
    -H "Authorization: Bearer $AUTH_BEARER" \
    -d "$payload"
}

extract_diagnostic() {
  local json="${1:-}"
  echo "$json" | jq -r '
    .body.issues.issue[0].diagnostics
    // .issues.issue[0].diagnostics
    // .body.issue[0].diagnostics
    // .issue[0].diagnostics
    // empty
  ' 2>/dev/null || true
}

assert_no_diagnostic_error() {
  local label="$1"
  local json="$2"
  local diagnostic
  diagnostic="$(extract_diagnostic "$json")"
  if [[ -n "$diagnostic" ]]; then
    echo "ERROR: $label failed: $diagnostic"
    exit 1
  fi
}

poll_async() {
  local url="$1"
  local thid="$2"
  local payload
  payload="$(jq -n --arg thid "$thid" '{thid:$thid}')"
  http_post_json "$url" "$payload"
}

echo "[0/5] Preflight: $BASE_URL/host/.well-known/ping"
rm -f /tmp/e2e-ping.out
PING_CODE="000"
for _try in 1 2 3 4 5 6 7 8 9 10; do
  PING_CODE="$(curl -sS -o /tmp/e2e-ping.out -w "%{http_code}" "$BASE_URL/host/.well-known/ping" || true)"
  if [[ "$PING_CODE" == "200" ]]; then
    break
  fi
  sleep 1
done
if [[ "$PING_CODE" != "200" ]]; then
  echo "ERROR: API not reachable at $BASE_URL (status=$PING_CODE)"
  if [[ -s /tmp/e2e-ping.out ]]; then
    echo "DETAIL: $(head -c 220 /tmp/e2e-ping.out)"
  fi
  exit 1
fi

if is_true "$ENSURE_TENANT"; then
  echo "[1/5] Ensuring tenant '$TENANT_ID' exists (host registry)..."
  THID_ORG="thid-org-$TENANT_ID-$(date +%s)"
  ORG_PAYLOAD="$(jq -n \
    --arg thid "$THID_ORG" \
    --arg tenant "$TENANT_ID" \
    --arg sector "$SECTOR" \
    '{
      thid:$thid,
      iss:"admin@example.com",
      aud:"did:web:host.example.com",
      body:{
        data:[{
          type:"Organization-registration-form-v1.0",
          resource:{resourceType:"Organization",meta:{claims:{
              "@context":"org.schema",
              "@type":"template",
              "org.schema.Organization.legalName":"Demo Tenant",
              "org.schema.Organization.identifier.additionalType":"TAX",
              "org.schema.Organization.identifier.value":("A-" + $tenant + "-001"),
              "org.schema.Organization.alternateName":$tenant,
              "org.schema.Organization.address.addressCountry":"ES",
              "org.schema.Person.identifier":"urn:uuid:admin-demo-001",
              "org.schema.Person.hasOccupation.identifier.additionalType":"v3-RoleCode",
              "org.schema.Person.hasOccupation.identifier.value":"RESPRSN",
              "org.schema.Person.email":"admin@example.com",
              "org.schema.Service.category":$sector,
              "org.schema.Service.identifier":"did:web:api.example.com",
              "org.schema.Service.termsOfService":"https://example.com/terms",
              "org.schema.Service.serviceType":"http://terminology.hl7.org/CodeSystem/v3-ActReason|SRVC"
          }}}
        }]
      }
    }')"

  ORG_CREATE_RESP="$(http_post_json "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_NETWORK/registry/org.schema/Organization/_batch" "$ORG_PAYLOAD")"
  echo "$ORG_CREATE_RESP" | jq '.'
  ORG_ERR="$(echo "$ORG_CREATE_RESP" | jq -r '.body.issues.issue[0].diagnostics // .issues.issue[0].diagnostics // empty')"
  if [[ -n "$ORG_ERR" && "$ORG_ERR" != *"already exists"* ]]; then
    echo "ERROR: tenant registration failed: $ORG_ERR"
    exit 1
  fi

  if [[ -z "$ORG_ERR" ]]; then
    ORG_POLL_RESP="$(poll_async "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_NETWORK/registry/org.schema/Organization/_batch-response" "$THID_ORG")"
    echo "$ORG_POLL_RESP" | jq '.'
    OFFER_ID="$(echo "$ORG_POLL_RESP" | jq -r '
      .body.data[0].resource.meta.claims["org.schema.Offer.identifier"]
      // .data[0].resource.meta.claims["org.schema.Offer.identifier"]
      // empty
    ')"
    if [[ -n "$OFFER_ID" ]]; then
      THID_ORDER="thid-order-$TENANT_ID-$(date +%s)"
      ORDER_PAYLOAD="$(jq -n --arg thid "$THID_ORDER" --arg offer "$OFFER_ID" '{
        thid:$thid,
        iss:"admin@example.com",
        aud:"did:web:host.example.com",
        body:{data:[{type:"Organization-order-request-v1.0",resource:{resourceType:"Order",meta:{claims:{
            "@context":"org.schema",
            "Order.acceptedOffer.identifier":$offer
        }}}}]}
      }')"
      ORDER_CREATE_RESP="$(http_post_json "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_NETWORK/registry/org.schema/Order/_batch" "$ORDER_PAYLOAD")"
      echo "$ORDER_CREATE_RESP" | jq '.'
      ORDER_CREATE_DIAG="$(echo "$ORDER_CREATE_RESP" | jq -r '.body.issues.issue[0].diagnostics // .issues.issue[0].diagnostics // .data[0].response.outcome.issue[0].diagnostics // empty')"
      if [[ "$ORDER_CREATE_DIAG" == *"No pending registration found for offerId"* ]]; then
        echo "INFO: tenant order skipped because registration was already finalized."
      else
        ORDER_POLL_RESP="$(poll_async "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_NETWORK/registry/org.schema/Order/_batch-response" "$THID_ORDER")"
        echo "$ORDER_POLL_RESP" | jq '.'
      fi
    else
      echo "WARN: no offer id found during tenant ensure; continuing."
    fi
  else
    echo "INFO: tenant already exists, skipping order."
  fi
fi

echo "[2/5] Creating subject in tenant vault (Person/_batch)..."
THID_SUBJECT="thid-subject-$TENANT_ID-$(date +%s)"
SUBJECT_PAYLOAD="$(jq -n \
  --arg thid "$THID_SUBJECT" \
  --arg sid "$SUBJECT_ID" \
  --arg salias "$SUBJECT_ALIAS" \
  --arg semail "$SUBJECT_EMAIL" \
  --arg sphone "$SUBJECT_PHONE" \
  --arg sector "$SECTOR" \
  --arg idType "$SUBJECT_IDENTIFIER_TYPE" \
  --arg idValue "$SUBJECT_IDENTIFIER_VALUE" \
  '{
    thid:$thid,
    iss:"did:web:controller.example.com",
    aud:"did:web:host.example.com",
    body:{
      data:[
        {
          type:"Individual-terms-v1.0",
          request:{method:"POST",url:"individual/org.schema/Person/"},
          meta:{claims:{
            "org.schema.Person.alternateName":$salias,
            "org.schema.Person.identifier":$sid,
            "org.schema.Person.email":$semail,
            "org.schema.Person.telephone":$sphone,
            "org.schema.Service.category":$sector,
            "org.schema.Service.identifier":"did:web:api-provider.example.com",
            "org.schema.Service.termsOfService":"https://provider.example.com/terms",
            "org.schema.Service.serviceType":"http://terminology.hl7.org/CodeSystem/v3-ActReason|FAMRQT"
          }}
        },
        {
          type:"Personal-identity-v1.0",
          request:{method:"POST",url:"individual/org.schema/Person/"},
          meta:{claims:{
            "org.schema.Person.identifier":$sid,
            "org.schema.Person.identifierType":$idType,
            "org.schema.Person.identifierValue":$idValue
          }}
        }
      ]
    }
  }')"

SUBJECT_CREATE_RESP="$(http_post_json "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.schema/Person/_batch" "$SUBJECT_PAYLOAD")"
echo "$SUBJECT_CREATE_RESP" | jq '.'
SUBJECT_POLL_RESP="$(poll_async "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.schema/Person/_batch-response" "$THID_SUBJECT")"
echo "$SUBJECT_POLL_RESP" | jq '.'

echo "[3/5] Creating Task + subtasks (NO voice-to in claims)..."
ROOT_FOCUS="$(printf '%s' "$TASK_BASED_ON" | awk -F',' '{print $1}' | xargs)"
ROOT_TASK_PAYLOAD="$(jq -n \
  --arg thid "$THID_TASK" \
  --arg taskId "$TASK_ID" \
  --arg subject "$SUBJECT_ID" \
  --arg owner "$OWNER_ID" \
  --arg focus "$ROOT_FOCUS" \
  --arg basedOn "$TASK_BASED_ON" \
  --arg displays "$TASK_BASED_ON_DISPLAYS" \
  --arg lang "$PHONE_LANGUAGE" \
  --arg max "$MAX_ATTEMPTS" \
  --arg retry "$RETRY_INTERVAL_MINUTES" \
  --arg scheduled "$SCHEDULED_FOR" \
  --arg salias "$SUBJECT_ALIAS" \
  --arg controllerEmail "$CONTROLLER_EMAIL" \
  '{
    thid:$thid,
    body:{data:[{
      type:"Task",
      request:{method:"POST"},
      resource:{
        resourceType:"Task",
        id:$taskId,
        description:"E2E reminder root task",
        meta:{claims:{
          "@context":"org.hl7.fhir.api",
          "id":$taskId,
          "status":"scheduled",
          "subject":$subject,
          "owner":$owner,
          "focus":$focus,
          "Task.based-on":$basedOn,
          "based-on-display":$displays,
          "channel":"phone",
          "trigger-type":"phone-call",
          "language":$lang,
          "max-attempts":$max,
          "restriction-repetitions":$max,
          "retry-interval-minutes":$retry,
          "timing-repeat-offset":$retry,
          "subject-display":$salias,
          "controller-email":$controllerEmail,
          "Task.scheduled-at":$scheduled,
          "execution-period-start":$scheduled
        }}
      }
    }]}
  }')"

TASK_CREATE_RESP="$(http_post_json "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/$TEST_TASK_FORMAT/Task/_batch" "$ROOT_TASK_PAYLOAD")"
echo "$TASK_CREATE_RESP" | jq '.'
assert_no_diagnostic_error "Task/_batch root" "$TASK_CREATE_RESP"
TASK_POLL_RESP="$(poll_async "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/$TEST_TASK_FORMAT/Task/_batch-response" "$THID_TASK")"
echo "$TASK_POLL_RESP" | jq '.'
assert_no_diagnostic_error "Task/_batch-response root" "$TASK_POLL_RESP"

IFS=',' read -r -a BASED_ON_ITEMS <<< "$TASK_BASED_ON"
IFS=',' read -r -a BASED_ON_DISPLAY_ITEMS <<< "$TASK_BASED_ON_DISPLAYS"

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

if [[ "${#BASED_ON_ITEMS[@]}" -gt 1 ]]; then
  for idx in "${!BASED_ON_ITEMS[@]}"; do
    base_ref="$(trim "${BASED_ON_ITEMS[$idx]}")"
    [[ -z "$base_ref" ]] && continue
    display_raw="${BASED_ON_DISPLAY_ITEMS[$idx]:-$base_ref}"
    display="$(trim "$display_raw")"
    sub_id="${TASK_ID}-sub-$((idx+1))"
    sub_thid="${THID_TASK}-sub-$((idx+1))"

    SUB_PAYLOAD="$(jq -n \
      --arg thid "$sub_thid" \
      --arg id "$sub_id" \
      --arg subject "$SUBJECT_ID" \
      --arg owner "$OWNER_ID" \
      --arg focus "$base_ref" \
      --arg display "$display" \
      --arg partOf "Task/$TASK_ID" \
      --arg lang "$PHONE_LANGUAGE" \
      --arg salias "$SUBJECT_ALIAS" \
      --arg controllerEmail "$CONTROLLER_EMAIL" \
      --arg scheduled "$SCHEDULED_FOR" \
      '{
        thid:$thid,
        body:{data:[{
          type:"Task",
          request:{method:"POST"},
          resource:{
            resourceType:"Task",
            id:$id,
            description:("Reminder item: " + $display),
            meta:{claims:{
              "@context":"org.hl7.fhir.api",
              "id":$id,
              "status":"scheduled",
              "subject":$subject,
              "owner":$owner,
              "focus":$focus,
              "Task.based-on":$focus,
              "based-on-display":$display,
              "part-of":$partOf,
              "channel":"phone",
              "trigger-type":"phone-call",
              "language":$lang,
              "subject-display":$salias,
              "controller-email":$controllerEmail,
              "Task.scheduled-at":$scheduled,
              "execution-period-start":$scheduled
            }}
          }
        }]}
      }')"

    SUB_CREATE_RESP="$(http_post_json "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/$TEST_TASK_FORMAT/Task/_batch" "$SUB_PAYLOAD")"
    echo "$SUB_CREATE_RESP" | jq '.'
    assert_no_diagnostic_error "Task/_batch subtask $sub_id" "$SUB_CREATE_RESP"
    SUB_POLL_RESP="$(poll_async "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/$TEST_TASK_FORMAT/Task/_batch-response" "$sub_thid")"
    echo "$SUB_POLL_RESP" | jq '.'
    assert_no_diagnostic_error "Task/_batch-response subtask $sub_id" "$SUB_POLL_RESP"
  done
fi

echo "[4/5] Waiting daemon call trigger (logs)..."
LOGS_URL="$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/$TEST_TASK_FORMAT/Task/_logs?taskId=$TASK_ID"
deadline=$(( $(date +%s) + WAIT_SECONDS ))
started=0
while (( $(date +%s) <= deadline )); do
  LOGS_RESP="$(curl -sS "$LOGS_URL" || true)"
  STARTED_COUNT="$(echo "$LOGS_RESP" | jq -r --arg task "$TASK_ID" '
    (
      [.logs[]? | select(.type=="voice-call-started" and (.taskId==$task or (.taskId|startswith($task + "-sub-"))))] | length
    ) +
    (
      [.tasks[]? | select((.id==$task or (.id|startswith($task + "-sub-"))) and (.metadata["voice-call-started-at"] != null))] | length
    )
  ' 2>/dev/null || echo "0")"
  if [[ "$STARTED_COUNT" =~ ^[0-9]+$ ]] && (( STARTED_COUNT > 0 )); then
    started=1
    echo "INFO: daemon started call for task=$TASK_ID"
    break
  fi
  sleep "$WAIT_POLL_SECONDS"
done

echo "[5/5] Final logs"
FINAL_LOGS="$(curl -sS "$LOGS_URL" || true)"
echo "$FINAL_LOGS" | jq '.'

if (( started == 0 )); then
  echo "WARN: no daemon call started in ${WAIT_SECONDS}s."
  echo "HINT: ensure API runs with CALL_REMINDER_DAEMON_ENABLED=true and CALL_VOICE_ENABLED=true."
  echo "HINT: ensure subject '$SUBJECT_ID' exists and has org.schema.Person.telephone in individual vault."
fi

echo "DONE:"
echo "  tenant=$TENANT_ID sector=$SECTOR jurisdiction=$JURISDICTION"
echo "  subject=$SUBJECT_ID phone=$SUBJECT_PHONE"
echo "  controllerEmail=${CONTROLLER_EMAIL:-<not-set>}"
echo "  taskId=$TASK_ID scheduledFor=$SCHEDULED_FOR"
echo "  logs=$LOG_FILE"
