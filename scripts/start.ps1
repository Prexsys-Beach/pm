$ErrorActionPreference = "Stop"

Write-Host "Starting PM MVP container..."
docker compose up -d --build
Write-Host "PM MVP is starting on http://localhost:8000"
