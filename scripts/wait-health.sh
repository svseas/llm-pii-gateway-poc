#!/usr/bin/env bash
# Poll all services until healthy (timeout 180s). On failure dump recent compose logs.
set -euo pipefail
cd "$(dirname "$0")/.."

OLLAMA_BASE_HOST="${OLLAMA_API_BASE_HOST:-http://localhost:11434}"
TIMEOUT="${HEALTH_TIMEOUT:-180}"

# endpoint list: "label|url" ; ollama is host-side, the rest are published ports
ENDPOINTS=(
  "litellm|http://localhost:4000/health/liveliness"
  "presidio-analyzer|http://localhost:5002/health"
  "presidio-anonymizer|http://localhost:5001/health"
  "ollama|${OLLAMA_BASE_HOST}/api/tags"
)

deadline=$(( $(date +%s) + TIMEOUT ))
for entry in "${ENDPOINTS[@]}"; do
  label="${entry%%|*}"; url="${entry#*|}"
  printf 'waiting for %-20s' "$label ..."
  while true; do
    if curl -sf -o /dev/null "$url" 2>/dev/null; then echo " OK"; break; fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo " TIMEOUT"
      echo "---- docker compose logs (tail) ----" >&2
      docker compose logs --tail 50 2>/dev/null || true
      exit 1
    fi
    sleep 3
  done
done
echo "all healthy."
