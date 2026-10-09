@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
  py -3 scripts\local_api.py --prompt-token
) else (
  python scripts\local_api.py --prompt-token
)
if errorlevel 1 pause
endlocal
