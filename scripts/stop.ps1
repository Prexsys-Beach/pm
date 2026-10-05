$ErrorActionPreference = "Stop"

Write-Host "Stopping PM MVP container..."
docker compose down
Write-Host "PM MVP stopped."
