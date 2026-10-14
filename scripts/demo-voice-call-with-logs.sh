#!/bin/bash
set -e

# Generate timestamped log filename
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOGS_DIR="./logs/voice-call-demos"
LOGS_FILE="$LOGS_DIR/demo-voice-call_${TIMESTAMP}.json"

mkdir -p "$LOGS_DIR"

echo "🎯 Starting Voice Call Demo with automatic log capture..."
echo "📁 Logs will be saved to: $LOGS_FILE"

# Extract phone number from arguments or use default
PHONE="${SUBJECT_PHONE:-+12365162385}"
echo "📱 Using phone: $PHONE"

# Run the demo voice call script
echo ""
echo "⏳ Executing demo-voice-call (waiting for task creation and daemon to trigger call)..."
SUBJECT_PHONE="$PHONE" npm run demo:voice-call

# Wait a bit for all logs to settle
echo ""
echo "⏳ Waiting for call to complete and logs to settle..."
sleep 3

# Fetch logs from the debug API
echo "🔍 Fetching logs from debug API..."
TASK_ID=$(curl -s http://localhost:3000/host/cds-ES/v1/test/individual/org.hl7.fhir.api/Task/_logs 2>/dev/null | jq -r '.tasks[0].id // empty' | head -1)

if [[ -z "$TASK_ID" ]]; then
  echo "⚠️  Warning: Could not determine task ID from logs"
  TASK_ID="unknown"
fi

echo "📋 Task ID: $TASK_ID"

# Fetch and save logs
curl -s "http://localhost:3000/host/cds-ES/v1/test/individual/org.hl7.fhir.api/Task/_logs?taskId=${TASK_ID}" | jq '.' > "$LOGS_FILE"

# Display summary
echo ""
echo "✅ Logs saved!"
echo ""
echo "📊 Summary:"
jq '{totalLogs: .totalLogs, logsPerType: (.logs | group_by(.type) | map({type: .[0].type, count: length})), taskCount: (.tasks | length)}' "$LOGS_FILE"

echo ""
echo "📄 Full logs available at: $LOGS_FILE"
echo ""
echo "🔍 To analyze the logs:"
echo "  jq '.logs' $LOGS_FILE"
echo ""
echo "🎯 To see task statuses:"
echo "  jq '.tasks[] | {id, status, adherence: .metadata[\"adherence-result\"], scheduledFor}' $LOGS_FILE"
echo ""
