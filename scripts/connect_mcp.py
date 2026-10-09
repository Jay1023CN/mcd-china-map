#!/usr/bin/env python3
"""Connect to official MCP; keep credentials in memory and responses private."""
import argparse
from datetime import datetime, timezone
import getpass
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.error import HTTPError, URLError

from mcp_readonly import Client, ENDPOINT, READ_TOOLS

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'private/mcp'


def save_private(name, value, directory=None):
    directory = OUTPUT if directory is None else directory
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = directory / name
    fd, temporary = tempfile.mkstemp(prefix='.response-', dir=directory)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prompt-token', action='store_true', help='enter a Token in a local terminal without echo; never saved')
    parser.add_argument('--tool', choices=sorted(READ_TOOLS), help='optional explicit read-only call after discovering tools')
    parser.add_argument('--args-file', type=Path, help='JSON arguments based on actual tools/list schema')
    args = parser.parse_args()
    if bool(args.tool) != bool(args.args_file):
        parser.error('--tool and --args-file must be used together')
    token = os.environ.get('MCD_MCP_TOKEN', '').strip()
    if not token and args.prompt_token:
        if not sys.stdin.isatty():
            parser.exit(2, 'Run --prompt-token in your local terminal, or configure the MCD_MCP_TOKEN environment secret.\n')
        try:
            token = getpass.getpass('麦当劳 MCP Token（不回显、不保存）：').strip()
        except (EOFError, KeyboardInterrupt):
            parser.exit(2, '\nToken entry cancelled.\n')
    if not token or token.startswith('${'):
        parser.exit(2, 'Missing MCD_MCP_TOKEN. Obtain your Token at https://open.mcd.cn/mcp, then configure the environment secret or run --prompt-token locally.\n')
    # Parse explicit arguments before any network activity.
    try:
        arguments = json.loads(args.args_file.read_text(encoding='utf-8')) if args.args_file else None
        if arguments is not None and not isinstance(arguments, dict):
            raise ValueError('tool arguments must be an object')
        client = Client(token)
        client.initialize()
        tools = client.tools()
        tool_names = [tool['name'] for tool in tools]
        save_private('tools.json', {'endpoint': ENDPOINT, 'tools': tools})
        record = {'endpoint': ENDPOINT, 'connected_at': datetime.now(timezone.utc).isoformat(),
                  'initialize_succeeded': True, 'tools_list_succeeded': True,
                  'available_read_tools': tool_names, 'tool_call': None}
        save_private('connection.json', record)
        print('Connected to official McDonald’s MCP.')
        print('Available read tools: ' + ', '.join(tool_names))
        print('Schemas saved to private/mcp/tools.json; no order query has been made yet.')
        if args.tool:
            if args.tool not in tool_names:
                raise ValueError('the requested tool is not exposed')
            result = client.rpc('tools/call', {'name': args.tool, 'arguments': arguments})
            if not isinstance(result, dict) or result.get('isError'):
                raise ValueError('tool returned an error or invalid result')
            save_private(args.tool + '.result.json', result)
            record['tool_call'] = {'name': args.tool, 'succeeded': True, 'called_at': datetime.now(timezone.utc).isoformat()}
            save_private('connection.json', record)
            print(f'{args.tool} succeeded. Response saved to private/mcp/{args.tool}.result.json; personal contents are not printed.')
    except HTTPError as exc:
        hints = {401: 'Token missing, invalid or expired.', 403: 'Access denied; check official access restrictions and network policy.', 429: 'Rate limit reached; retry later.'}
        parser.exit(2, f'Official MCP HTTP {exc.code}: {hints.get(exc.code, "Request failed.")}\n')
    except (URLError, TimeoutError, OSError):
        parser.exit(2, 'Could not connect or save local files; check network and file permissions.\n')
    except (ValueError, KeyError, TypeError):
        parser.exit(2, 'Input, tool availability or MCP response is invalid; inspect the current schema locally.\n')


if __name__ == '__main__':
    main()
