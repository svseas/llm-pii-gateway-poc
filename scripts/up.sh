#!/usr/bin/env bash
# Bring up the stack for a given profile, after preflight checks. Does NOT pull images itself.
#   ./scripts/up.sh 2         -> profile 2 (default, pragmatic)
#   ./scripts/up.sh 1         -> profile 1 (strict/aggressive: masks PERSON, blocks CREDIT_CARD)
#   ./scripts/up.sh capture   -> capture profile (upstream = mock recorder) for T4
set -euo pipefail
cd "$(dirname "$0")/.."

# Load .env so preflight can read OLLAMA_* / image pins.
if [ -f .env ]; then set -a; . ./.env; set +a; else
  echo "ERROR: .env not found. Run: cp .env.example .env  (then edit)"; exit 1
fi

PROFILE="${1:-${LITELLM_PROFILE:-2}}"
OLLAMA_BASE_HOST="${OLLAMA_API_BASE_HOST:-http://localhost:11434}"   # host-side view of Ollama
LITELLM_IMAGE="${LITELLM_IMAGE:-ghcr.io/berriai/litellm:v1.98.0}"
PRESIDIO_ANALYZER_IMAGE="${PRESIDIO_ANALYZER_IMAGE:-ghcr.io/data-privacy-stack/presidio-analyzer:2.2.362}"
PRESIDIO_ANONYMIZER_IMAGE="${PRESIDIO_ANONYMIZER_IMAGE:-ghcr.io/data-privacy-stack/presidio-anonymizer:2.2.362}"

fail() { echo "PREFLIGHT FAILED: $1" >&2; echo "FIX: $2" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "docker not found" "install Docker Desktop"
docker info >/dev/null 2>&1 || fail "docker daemon not running" "start Docker Desktop"

# 1. Ollama reachable + model pulled (only needed for real-upstream profiles 1/2, not capture).
if [ "$PROFILE" != "capture" ]; then
  if ! curl -sf "${OLLAMA_BASE_HOST}/api/tags" >/dev/null 2>&1; then
    fail "Ollama not reachable at ${OLLAMA_BASE_HOST}" "install Ollama and run: ollama serve"
  fi
  MODEL="${OLLAMA_MODEL:-qwen2.5-coder:7b}"
  if ! curl -sf "${OLLAMA_BASE_HOST}/api/tags" | grep -q "${MODEL%%:*}"; then
    fail "Ollama model '${MODEL}' not present" "ollama pull ${MODEL}"
  fi
fi

# 2. Images pullable (dry check via manifest inspect; does not download layers).
check_img() {
  docker manifest inspect "$1" >/dev/null 2>&1 || docker image inspect "$1" >/dev/null 2>&1 \
    || fail "image not pullable/local: $1" "verify the tag/registry, or override *_IMAGE in .env"
}
check_img "$LITELLM_IMAGE"
check_img "$PRESIDIO_ANALYZER_IMAGE"
check_img "$PRESIDIO_ANONYMIZER_IMAGE"

# 3. Bring up.
case "$PROFILE" in
  capture)
    echo "-> capture profile (upstream = mock recorder)"
    mkdir -p results/captured-requests
    LITELLM_CONFIG=./configs/config.capture.yaml docker compose --profile capture up -d
    ;;
  1|2)
    echo "-> profile ${PROFILE}"
    LITELLM_PROFILE="$PROFILE" LITELLM_CONFIG= docker compose up -d
    ;;
  *)
    fail "unknown profile '$PROFILE'" "use: 1 | 2 | capture"
    ;;
esac

./scripts/wait-health.sh
echo "Stack up (profile=${PROFILE})."
