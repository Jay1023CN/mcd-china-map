@echo off
cd /d "%~dp0"
if not exist ".venv-web\Scripts\python.exe" (
    py -3 -m venv .venv-web
    if errorlevel 1 goto failed
    ".venv-web\Scripts\python.exe" -m pip install -r requirements-web.txt
    if errorlevel 1 goto failed
)
".venv-web\Scripts\python.exe" scripts\web_api.py --port 8080 --open-browser
if errorlevel 1 goto failed
exit /b 0
:failed
echo Web app could not start. Check Python and requirements-web.txt.
pause
exit /b 1
