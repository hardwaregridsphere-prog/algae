#!/bin/sh
set -e

BACKUP_DIR="/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="$BACKUP_DIR/algaetree_db_$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "Executing PostgreSQL backup: $FILENAME"
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h postgres -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$FILENAME"

# Retention policy: Remove backups older than 14 days
find "$BACKUP_DIR" -type f -name "algaetree_db_*.sql.gz" -mtime +14 -exec rm {} \;
echo "Backup and rotation completed successfully."