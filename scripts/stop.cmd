@echo off
setlocal
echo Stopping PM MVP container...
docker compose down
if errorlevel 1 exit /b %errorlevel%
echo PM MVP stopped.
