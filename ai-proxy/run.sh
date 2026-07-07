#!/bin/bash
# PhantomForce ai-proxy supervisor — start this ONCE and never think about it
# again. server.mjs exits by itself whenever a git pull delivers new code;
# this loop restarts it on the new version within seconds.
#
#   bash ai-proxy/run.sh
#
# (Pair with the auto-sync cron that already pulls main every few minutes and
# the whole pipeline is hands-free: push to main -> live proxy updates itself.)
cd "$(dirname "$0")"
while true; do
  node server.mjs
  echo "ai-proxy: restarting in 2s..."
  sleep 2
done
