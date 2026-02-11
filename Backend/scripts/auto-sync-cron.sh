#!/bin/sh
set -e
exec sh scripts/orchestrators/auto-sync-cron.sh "$@"
