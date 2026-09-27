#!/usr/bin/env bash
# Prepare a machine to run the Evidence Gate.
set -euo pipefail

GUARD="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN="${1:-$HOME/jev-rca}"
PK_URL="https://raw.githubusercontent.com/FailproofAI/jev-buildathon/main/policykit/index.mjs"

echo "guard : $GUARD"
echo "run   : $RUN"
echo

# 1. policykit — fetched, not redistributed (the source repo ships no LICENSE).
if [ ! -f "$GUARD/policykit/index.mjs" ]; then
  echo "fetching policykit from FailproofAI/jev-buildathon ..."
  mkdir -p "$GUARD/policykit"
  curl -fsSL "$PK_URL" -o "$GUARD/policykit/index.mjs" \
    || { echo "  could not fetch it — clone FailproofAI/jev-buildathon and copy policykit/index.mjs here"; exit 1; }
fi
echo "ok  policykit present"

# 2. The agent's working directory holds ONLY the world.
mkdir -p "$RUN"
rm -rf "$RUN/world"
cp -R "$GUARD/world" "$RUN/world"
rm -f "$RUN/world/disposition.json" "$RUN/disposition.json"
echo "ok  $RUN/world  ($(ls "$RUN/world" | wc -l | tr -d ' ') records, and nothing else the agent can read)"

echo
echo "next, on this machine:"
echo "  npm i -g failproofai@next"
echo "  failproofai config --token <your FailproofAI Cloud key>"
echo "  failproofai jev test                 # must pass, or askJev throws"
echo "  cd $RUN && failproofai policies -i -c $GUARD/rca-policies.mjs --cli claude --scope project"
echo
echo "then run a task from TASKS.md:"
echo "  cd $RUN && claude"
echo
echo "the guard defaults to shadow (evaluates and logs, never blocks)."
echo "RCA_MODE=enforce makes it block."
