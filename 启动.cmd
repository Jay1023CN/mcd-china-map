@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -c "import sys; sys.exit(not sys.version_info.__ge__((3,10)))" >nul 2>nul
  if not errorlevel 1 (
    py -3 scripts\local_api.py
    if errorlevel 1 pause
    exit /b
  )
)
where python >nul 2>nul
if not errorlevel 1 (
  python -c "import sys; sys.exit(not sys.version_info.__ge__((3,10)))" >nul 2>nul
  if not errorlevel 1 (
    python scripts\local_api.py
    if errorlevel 1 pause
    exit /b
  )
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\serve-local.ps1"
if errorlevel 1 pause
endlocal
