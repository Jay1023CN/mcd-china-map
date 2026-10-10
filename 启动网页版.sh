#!/bin/sh
# Linux / macOS launcher. Run with: sh ./启动网页版.sh
set -eu
cd "$(dirname "$0")"

if command -v python3 >/dev/null 2>&1; then
    python_command=python3
elif command -v python >/dev/null 2>&1; then
    python_command=python
else
    printf '%s\n' 'Python 3.10 or newer is required.' >&2
    exit 1
fi

"$python_command" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || {
    printf '%s\n' 'Python 3.10 or newer is required.' >&2
    exit 1
}

# Keep a Unix environment separate from any existing Windows environment.
web_environment=.venv-web-unix
if [ ! -x "$web_environment/bin/python" ]; then
    "$python_command" -m venv "$web_environment"
    "$web_environment/bin/python" -m pip install -r requirements-web.txt
fi

exec "$web_environment/bin/python" scripts/web_api.py "$@"
