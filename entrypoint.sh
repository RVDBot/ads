#!/bin/sh
mkdir -p /app/data
chown app:app /app/data
chown app:app /app/data/*.db /app/data/*.db-wal /app/data/*.db-shm 2>/dev/null || true
exec su-exec app node server.js
