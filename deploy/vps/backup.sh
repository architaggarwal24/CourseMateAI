#!/bin/sh
# Daily backup (the "backup" profile of docker-compose.yml): the database and the kept PDFs into /backups,
# keeping KEEP_DAYS days. PostgreSQL when DATABASE_URL is set (pg_dump), else SQLite's online .backup.
set -eu
stamp=$(date -u +%Y%m%d-%H%M)
mkdir -p /backups
if [ -n "${DATABASE_URL:-}" ]; then
  pg_dump --format=custom --file="/backups/coursemate-$stamp.dump" "$DATABASE_URL"
else
  sqlite3 /data/coursemate.db ".backup /backups/coursemate-$stamp.db"
fi
if [ -d /uploads/files ]; then
  tar -czf "/backups/uploads-$stamp.tar.gz" -C /uploads files
fi
find /backups -type f -mtime +"${KEEP_DAYS:-14}" -delete
echo "backup $stamp done"
