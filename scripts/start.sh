#!/usr/bin/env bash
set -euo pipefail

echo "Starting PM MVP container..."
docker compose up -d --build
echo "PM MVP is starting on http://localhost:8000"
