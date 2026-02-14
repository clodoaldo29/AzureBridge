#!/bin/sh
set -e

DAILY_CRON="${AUTO_SYNC_CRON_DAILY:-0 2 * * *}"
HOURLY_CRON="${AUTO_SYNC_CRON_HOURLY:-0 * * * *}"
RUN_ON_START="${AUTO_SYNC_RUN_ON_START:-false}"
RUN_ON_START_MODE="${AUTO_SYNC_RUN_ON_START_MODE:-daily}"

echo "AUTO SYNC CRON"
echo "============================================================"
echo "Hourly: ${HOURLY_CRON}"
echo "Daily:  ${DAILY_CRON}"
echo "Run on start: ${RUN_ON_START} (${RUN_ON_START_MODE})"

cat > /etc/cron.d/azurebridge-auto-sync <<EOF
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

${HOURLY_CRON} root cd /app && AUTO_SYNC_MODE=hourly npx tsx scripts/auto-sync.ts >> /proc/1/fd/1 2>> /proc/1/fd/2
${DAILY_CRON} root cd /app && AUTO_SYNC_MODE=daily npx tsx scripts/auto-sync.ts >> /proc/1/fd/1 2>> /proc/1/fd/2
EOF

chmod 0644 /etc/cron.d/azurebridge-auto-sync
crontab /etc/cron.d/azurebridge-auto-sync

if [ "$RUN_ON_START" = "true" ]; then
  echo "Running auto-sync immediately (mode: ${RUN_ON_START_MODE})"
  AUTO_SYNC_MODE="$RUN_ON_START_MODE" npx tsx scripts/auto-sync.ts || true
fi

cron -f
