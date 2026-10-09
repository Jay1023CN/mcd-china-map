@echo off
setlocal
cd /d "%~dp0.."
set "PORT=%~1"
if not "%PORT%"=="8765" if not "%PORT%"=="18765" goto usage
if not "%~2"=="" goto usage

where py >nul 2>nul
if errorlevel 1 goto try_python
py -3 -c "import sys; sys.exit(not sys.version_info.__ge__((3,10)))" >nul 2>nul
if errorlevel 1 goto try_python
py -3 scripts\local_api.py --port %PORT%
if errorlevel 1 goto failed
exit /b 0

:try_python
where python >nul 2>nul
if errorlevel 1 goto powershell_fallback
python -c "import sys; sys.exit(not sys.version_info.__ge__((3,10)))" >nul 2>nul
if errorlevel 1 goto powershell_fallback
python scripts\local_api.py --port %PORT%
if errorlevel 1 goto failed
exit /b 0

:powershell_fallback
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve-local.ps1" -Port %PORT%
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo The selected fixed port could not start; no other process was stopped.
if "%PORT%"=="8765" echo Try the alternate fixed-port launcher for port 18765.
if "%PORT%"=="18765" echo Try the primary fixed-port launcher for port 8765.
exit /b 1

:usage
echo Usage: scripts\start-local.cmd 8765 or 18765
exit /b 2
