#!/usr/bin/env python3
"""Read official orders and optional benefits, then build a private journal."""
import argparse
import getpass
import os
import sys
from datetime import datetime, timezone
from uuid import uuid4
from urllib.error import HTTPError, URLError

from connect_mcp import OUTPUT, save_private
from import_mcp_footprints import normalize, read_result
from mcp_readonly import Client
from build_global_journal import candidates, render
from store_enrichment import enrich_archive


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prompt-token', action='store_true')
    parser.add_argument('--order-offset', required=True, help='explicit offset for order times lacking timezone, e.g. +08:00')
    parser.add_argument('--with-benefits', action='store_true', help='read coupons and campaigns; never claim coupons')
    args = parser.parse_args()
    token = os.environ.get('MCD_MCP_TOKEN', '').strip()
    if not token and args.prompt_token:
        if not sys.stdin.isatty():
            parser.exit(2, 'Use a local terminal for --prompt-token, or bind MCD_MCP_TOKEN as an environment secret.\n')
        try:
            token = getpass.getpass('MCP Token（不回显、不保存）：').strip()
        except (EOFError, KeyboardInterrupt):
            parser.exit(2, '\nToken entry cancelled.\n')
    try:
        client = Client(token)
        client.initialize()
        tools = {tool['name']: tool for tool in client.tools()}
        run_output = OUTPUT / 'runs' / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid4().hex[:8])
        save_private('tools.json', {'tools': list(tools.values())}, directory=run_output)

        def fetch(name, arguments, filename):
            if name not in tools:
                raise ValueError('required read-only tool is unavailable')
            required = tools[name]['inputSchema'].get('required', [])
            if not set(required).issubset(arguments):
                raise ValueError('current schema requires additional explicit arguments')
            result = client.rpc('tools/call', {'name': name, 'arguments': arguments})
            if result.get('isError') or result.get('structuredContent', {}).get('success') is not True:
                raise ValueError('official read failed; no synthetic fallback')
            save_private(filename, result, directory=run_output)
            print(name + ': succeeded; saved privately.', flush=True)

        # Isolate each run; preserve earlier raw responses and successful reports.
        fetch('now-time-info', {}, 'now-time-info.result.json')
        fetch('order-list', {}, 'order-list.result.json')
        listing = read_result(run_output / 'order-list.result.json')
        if len(listing['list']) > 100:
            raise ValueError('large response requires an explicit query plan; no incomplete automatic run')
        for index, row in enumerate(listing['list'], 1):
            fetch('query-order', {'orderId': row['orderId']}, f'order-detail-{index:02d}.json')
        if args.with_benefits:
            fetch('available-coupons', {}, 'available-coupons.result.json')
            fetch('campaign-calendar', {}, 'campaign-calendar.result.json')
        payload = normalize(run_output, args.order_offset)
        save_private('footprints.normalized.json', payload, directory=run_output)
        global_archive = enrich_archive(candidates(payload))
        page = render(global_archive)
        save_private('global-candidates.json', global_archive, directory=run_output)
        for name, content in [('global-passport.html', page)]:
            path = run_output / name
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                stream.write(content)
            os.chmod(path, 0o600)
        # Publish the import file only after the entire run has succeeded.
        save_private('footprints.normalized.json', payload)
        save_private('global-candidates.json', global_archive)
        save_private('latest-sync.json', {'completed_at': datetime.now(timezone.utc).isoformat(),
                                        'response_directory': str(run_output.relative_to(OUTPUT)),
                                        'candidate_count': len(global_archive['entries'])})
        print('Import file generated: private/mcp/global-candidates.json')
        print('Raw responses and candidate page saved in a separate private/mcp/runs directory.')
        print('China orders remain unconfirmed candidates; no visit has been assumed.')
    except HTTPError as error:
        parser.exit(2, f'Official MCP HTTP {error.code}; no new report generated; previous successful import preserved.\n')
    except (ValueError, KeyError, TypeError, OSError, URLError):
        parser.exit(2, 'Connection, input or observed schema failed; no new report generated; previous successful import preserved. Inspect private/mcp/runs.\n')


if __name__ == '__main__':
    main()
