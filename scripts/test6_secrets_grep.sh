#!/usr/bin/env bash
# T6 [no-key] (optional): how noisy would a naive secrets BLOCK rule be on a repo?
# Counts files that a pre_call BLOCK regex would hard-block => "N devs interrupted per pass".
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && { set -a; . ./.env; set +a; }

REPO="${CORPUS_DIR:-.}"
OUT="results/secrets-noise.txt"
mkdir -p results

# A common naive secret-rule family. -l = files with a match; count them.
count="$(grep -rlIE --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=bin --exclude-dir=obj \
  -e 'password[[:space:]]*=' -e 'postgres://' -e 'mysql://' -e 'AKIA[0-9A-Z]{16}' \
  "$REPO" 2>/dev/null | wc -l | tr -d ' ')"

{
  echo "T6 secrets-regex noise on a repo"
  echo "repo:      $REPO"
  echo "rule:      password= | postgres:// | mysql:// | AKIA[0-9A-Z]{16}"
  echo "files_hit: $count"
  echo
  echo "=> If this became a pre_call BLOCK rule, $count files would hard-block a dev per pass."
  echo "   (In a full-local architecture there is no egress to protect; this measures BLOCK-rule noise.)"
  echo
  echo "-- sample matched files (up to 20) --"
  grep -rlIE --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=bin --exclude-dir=obj \
    -e 'password[[:space:]]*=' -e 'postgres://' -e 'mysql://' -e 'AKIA[0-9A-Z]{16}' \
    "$REPO" 2>/dev/null | head -20
} | tee "$OUT"
