@echo off
setlocal
cd /d "%~dp0"
set "archive_args="
if exist "private\mcp\global-candidates.json" set archive_args=--archive "private\mcp\global-candidates.json"
where py >nul 2>nul
if not errorlevel 1 (
  py -3 scripts\local_api.py --prompt-token %archive_args%
) else (
  python scripts\local_api.py --prompt-token %archive_args%
)
if errorlevel 1 pause
endlocal
