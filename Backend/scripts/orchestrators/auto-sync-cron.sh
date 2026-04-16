#!/bin/sh
set -e

DAILY_CRON="${AUTO_SYNC_CRON_DAILY:-0 2 * * *}"
HOURLY_CRON="${AUTO_SYNC_CRON_HOURLY:-0 * * * *}"
RUN_ON_START="${AUTO_SYNC_RUN_ON_START:-false}"
RUN_ON_START_MODE="${AUTO_SYNC_RUN_ON_START_MODE:-daily}"
SYSTEM_TZ="${TZ:-UTC}"

if [ -f "/usr/share/zoneinfo/${SYSTEM_TZ}" ]; then
  ln -snf "/usr/share/zoneinfo/${SYSTEM_TZ}" /etc/localtime
  echo "${SYSTEM_TZ}" > /etc/timezone
else
  echo "Timezone '${SYSTEM_TZ}' not found, falling back to UTC"
  SYSTEM_TZ="UTC"
  ln -snf /usr/share/zoneinfo/Etc/UTC /etc/localtime
  echo "Etc/UTC" > /etc/timezone
fi

echo "AUTO SYNC CRON"
echo "============================================================"
echo "Timezone: ${SYSTEM_TZ}"
echo "Hourly: ${HOURLY_CRON}"
echo "Daily:  ${DAILY_CRON}"
echo "Run on start: ${RUN_ON_START} (${RUN_ON_START_MODE})"

# Persist container env so cron jobs can source Azure/DB variables.
env | sed 's/\\/\\\\/g; s/"/\\"/g; s/^\([^=]*\)=\(.*\)$/export \1="\2"/' > /app/.cron_env

cat > /etc/cron.d/azurebridge-auto-sync <<EOF
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
CRON_TZ=${SYSTEM_TZ}
TZ=${SYSTEM_TZ}

${HOURLY_CRON} root . /app/.cron_env && cd /app && AUTO_SYNC_MODE=hourly npx tsx scripts/orchestrators/auto-sync.ts >> /proc/1/fd/1 2>> /proc/1/fd/2
${DAILY_CRON} root . /app/.cron_env && cd /app && AUTO_SYNC_MODE=daily npx tsx scripts/orchestrators/auto-sync.ts >> /proc/1/fd/1 2>> /proc/1/fd/2
EOF

chmod 0644 /etc/cron.d/azurebridge-auto-sync
crontab /etc/cron.d/azurebridge-auto-sync

if [ "$RUN_ON_START" = "true" ]; then
  echo "Running auto-sync immediately (mode: ${RUN_ON_START_MODE})"
  AUTO_SYNC_MODE="$RUN_ON_START_MODE" npx tsx scripts/orchestrators/auto-sync.ts || true
fi

cron -f
