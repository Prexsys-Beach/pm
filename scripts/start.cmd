@echo off
setlocal
echo Starting PM MVP container...
docker compose up -d --build
if errorlevel 1 exit /b %errorlevel%
echo PM MVP is starting on http://localhost:8000
