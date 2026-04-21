#!/usr/bin/env bash
# Combined entrypoint: starts CES → assistant daemon → gateway in one
# container, all backed by a single /data volume.
#
# Volume layout (via /root/.vellum → /data/vellum symlink):
#   /data/vellum/workspace/          — $VELLUM_WORKSPACE_DIR
#   /data/vellum/protected/          — $CREDENTIAL_SECURITY_DIR (shared);
#                                       holds keys.enc, store.key,
#                                       actor-token-signing-key
#   /data/vellum/ces-data/           — $CES_DATA_ROOT (grants, audit,
#                                       toolstore)
#
# Startup order:
#   1. CES (managed mode) — creates /run/ces-bootstrap/ces.sock and blocks
#      waiting for exactly one assistant connection.
#   2. Assistant daemon   — connects to the bootstrap socket on startup.
#   3. Gateway            — polls credentials from the shared dir; starts
#      Slack Socket Mode when slack_channel creds appear.

set -euo pipefail

DATA_ROOT="${DATA_ROOT:-/data}"
VELLUM_DATA_DIR="${DATA_ROOT}/vellum"
CES_BOOTSTRAP_DIR="${CES_BOOTSTRAP_SOCKET_DIR:-/run/ces-bootstrap}"
CES_DATA_DIR="${CES_DATA_ROOT:-${VELLUM_DATA_DIR}/ces-data}"

# ---------------------------------------------------------------------
# 1. Prepare the volume layout
# ---------------------------------------------------------------------
mkdir -p "${VELLUM_DATA_DIR}/workspace"
mkdir -p "${VELLUM_DATA_DIR}/protected"
chmod 700 "${VELLUM_DATA_DIR}/protected"
mkdir -p "${CES_DATA_DIR}"
mkdir -p "${CES_BOOTSTRAP_DIR}"
chmod 755 "${CES_BOOTSTRAP_DIR}"
# /run is ephemeral on every boot; clear any stale socket so CES can bind.
rm -f "${CES_BOOTSTRAP_DIR}/ces.sock"

# Symlink /root/.vellum -> /data/vellum so:
#   homedir()/.vellum                 resolves onto the volume
#   $CREDENTIAL_SECURITY_DIR          (same dir) — CES writes keys.enc
#   $GATEWAY_SECURITY_DIR             (same dir) — gateway reads keys.enc
#   $VELLUM_WORKSPACE_DIR override    also resolves onto the volume
if [ -L /root/.vellum ]; then
  :
elif [ -e /root/.vellum ]; then
  if [ ! -e "${VELLUM_DATA_DIR}/.bootstrapped" ]; then
    cp -a /root/.vellum/. "${VELLUM_DATA_DIR}/" 2>/dev/null || true
    touch "${VELLUM_DATA_DIR}/.bootstrapped"
  fi
  rm -rf /root/.vellum
  ln -s "${VELLUM_DATA_DIR}" /root/.vellum
else
  ln -s "${VELLUM_DATA_DIR}" /root/.vellum
fi

echo "[entrypoint] /root/.vellum -> $(readlink /root/.vellum)"
echo "[entrypoint] workspace:        ${VELLUM_WORKSPACE_DIR:-unset}"
echo "[entrypoint] security dir:     ${CREDENTIAL_SECURITY_DIR:-unset}"
echo "[entrypoint] ces data root:    ${CES_DATA_DIR}"
echo "[entrypoint] ces bootstrap:    ${CES_BOOTSTRAP_DIR}/ces.sock"

# ---------------------------------------------------------------------
# 2. Signal propagation — kill all children on SIGTERM/SIGINT
# ---------------------------------------------------------------------
CES_PID=""
ASSISTANT_PID=""
GATEWAY_PID=""

cleanup() {
  echo "[entrypoint] signal received, stopping children..."
  [ -n "${GATEWAY_PID}" ]   && kill -TERM "${GATEWAY_PID}"   2>/dev/null || true
  [ -n "${ASSISTANT_PID}" ] && kill -TERM "${ASSISTANT_PID}" 2>/dev/null || true
  [ -n "${CES_PID}" ]       && kill -TERM "${CES_PID}"       2>/dev/null || true
  wait 2>/dev/null || true
  exit 0
}
trap cleanup TERM INT

# ---------------------------------------------------------------------
# 3. Start CES (managed mode). It binds the bootstrap socket and waits
#    for exactly one assistant connection. Runs in background because
#    the assistant must start next to satisfy that wait.
# ---------------------------------------------------------------------
cd /app/credential-executor
bun run src/managed-main.ts &
CES_PID=$!
echo "[entrypoint] ces       started (pid=${CES_PID})"

# Wait (briefly) for CES to create the bootstrap socket before the
# assistant tries to connect. 30s max — longer than this means CES
# failed to boot, and we want to surface that instead of letting the
# assistant spin on a missing socket.
for _ in $(seq 1 30); do
  if [ -S "${CES_BOOTSTRAP_DIR}/ces.sock" ]; then break; fi
  sleep 1
done
if [ ! -S "${CES_BOOTSTRAP_DIR}/ces.sock" ]; then
  echo "[entrypoint] WARN: CES bootstrap socket still missing after 30s;" \
       "assistant will fall back to local CES discovery"
fi

# ---------------------------------------------------------------------
# 4. Start assistant daemon. Binds 127.0.0.1:3001 (or whatever
#    $RUNTIME_HTTP_PORT is set to). The first credential access will
#    connect to the CES bootstrap socket above.
# ---------------------------------------------------------------------
cd /app/assistant
bun --smol run src/daemon/main.ts &
ASSISTANT_PID=$!
echo "[entrypoint] assistant started (pid=${ASSISTANT_PID})"

# Short pause so the daemon can initialise before the gateway starts
# probing it. The gateway retries on connection failure, so this isn't
# strictly required — it just reduces log noise at startup.
sleep 3

# ---------------------------------------------------------------------
# 5. Start gateway (binds 0.0.0.0:7830, public-facing).
# ---------------------------------------------------------------------
cd /app/gateway
bun run src/index.ts &
GATEWAY_PID=$!
echo "[entrypoint] gateway   started (pid=${GATEWAY_PID})"

# ---------------------------------------------------------------------
# 6. Wait for any child to exit; bring the whole container down so Fly
#    restarts us cleanly instead of leaving a half-up state.
# ---------------------------------------------------------------------
wait -n "${CES_PID}" "${ASSISTANT_PID}" "${GATEWAY_PID}"
EXIT_CODE=$?
echo "[entrypoint] a child process exited (code=${EXIT_CODE}), shutting down"
cleanup
exit "${EXIT_CODE}"
