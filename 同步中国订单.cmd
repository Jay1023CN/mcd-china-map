@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
  py -3 scripts\sync_footprints.py --prompt-token --order-offset +08:00
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo Python 3 is needed for optional China MCP sync.
    echo Install from https://www.python.org/downloads/windows/
    pause
    exit /b 1
  )
  python scripts\sync_footprints.py --prompt-token --order-offset +08:00
)
if errorlevel 1 (
  echo Sync failed. No new candidates were created.
  pause
  exit /b 1
)
echo Import global-candidates.json into the running journal.
start "" "%~dp0private\mcp"
pause
