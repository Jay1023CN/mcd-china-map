#!/usr/bin/env python3
"""Minimal read-only Streamable HTTP client for the official McDonald's MCP.

Read credentials from MCD_MCP_TOKEN, never from a command argument. Tool results
may contain personal order data; redirect them to the ignored private directory.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ENDPOINT = "https://mcp.mcd.cn"
READ_TOOLS = frozenset({"order-list", "query-order", "now-time-info", "campaign-calendar", "available-coupons", "query-nearby-stores"})


def decode_sse(response: Any, request_id: int) -> dict[str, Any]:
    """Read one matching JSON-RPC result; skip notifications and comments."""
    data = []
    for raw in response:
        line = raw.decode("utf-8").rstrip("\r\n")
        if not line:
            if data:
                payload = json.loads("\n".join(data))
                data = []
                if isinstance(payload, dict) and payload.get("id") == request_id:
                    return payload
        elif line.startswith("data:"):
            data.append(line[5:].lstrip(" "))
    if data:
        payload = json.loads("\n".join(data))
        if isinstance(payload, dict) and payload.get("id") == request_id:
            return payload
    raise ValueError("no matching JSON-RPC response")


class Client:
    def __init__(self, token: str):
        if not token.strip() or token.startswith("${"):
            raise ValueError("configure MCD_MCP_TOKEN locally first")
        self._token = token
        self._session: str | None = None
        self._protocol: str | None = None
        self._counter = 0

    def rpc(self, method: str, params: dict[str, Any], *, notification: bool = False) -> Any:
        if method not in {"initialize", "notifications/initialized", "tools/list", "tools/call"}:
            raise ValueError("unsupported RPC method")
        if method == "tools/call" and params.get("name") not in READ_TOOLS:
            raise ValueError("this client permits only the reviewed read-only tools")
        self._counter += 1
        payload: dict[str, Any] = {"jsonrpc": "2.0", "method": method, "params": params}
        if not notification:
            payload["id"] = self._counter
        headers = {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json",
                   "Accept": "application/json, text/event-stream"}
        if self._session:
            headers["Mcp-Session-Id"] = self._session
        if self._protocol:
            headers["MCP-Protocol-Version"] = self._protocol
        request = Request(ENDPOINT, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
        with urlopen(request, timeout=30) as response:
            self._session = response.headers.get("Mcp-Session-Id", self._session)
            if notification:
                return None
            content_type = response.headers.get("Content-Type", "")
            if "text/event-stream" in content_type:
                result = decode_sse(response, self._counter)
            else:
                result = json.load(response)
        if not isinstance(result, dict) or result.get("id") != self._counter:
            raise ValueError("invalid JSON-RPC response")
        if "error" in result:
            # Do not echo arbitrary server error content or raw personal data.
            raise ValueError("MCP returned a JSON-RPC error; check the current tool schema")
        return result["result"]

    def initialize(self) -> None:
        result = self.rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                         "clientInfo": {"name": "mcd-china-map", "version": "0.2.0"}})
        protocol = result.get("protocolVersion")
        if not isinstance(protocol, str) or not protocol:
            raise ValueError("server did not negotiate a protocol version")
        self._protocol = protocol
        self.rpc("notifications/initialized", {}, notification=True)

    def tools(self) -> list[dict[str, Any]]:
        collected = []
        cursor = None
        seen = set()
        for _ in range(50):
            result = self.rpc("tools/list", {"cursor": cursor} if cursor else {})
            collected.extend(tool for tool in result["tools"] if tool["name"] in READ_TOOLS)
            cursor = result.get("nextCursor")
            if not cursor:
                return collected
            if cursor in seen:
                raise ValueError("tool pagination repeated a cursor")
            seen.add(cursor)
        raise ValueError("too many tool pages")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("tools", help="discover the current schemas of allowed read-only tools")
    call = sub.add_parser("call", help="call one discovered read-only tool")
    call.add_argument("tool", choices=sorted(READ_TOOLS))
    call.add_argument("--args-file", type=Path, required=True, help="JSON arguments copied from the current schema")
    args = parser.parse_args()
    try:
        arguments = None
        if args.command == "call":
            arguments = json.loads(args.args_file.read_text(encoding="utf-8"))
            if not isinstance(arguments, dict):
                raise ValueError("tool arguments must be a JSON object")
        client = Client(os.environ.get("MCD_MCP_TOKEN", ""))
        client.initialize()
        tools = client.tools()
        if args.command == "tools":
            result = {"endpoint": ENDPOINT, "tools": tools}
        else:
            if args.tool not in {tool["name"] for tool in tools}:
                raise ValueError("the selected read-only tool is not currently exposed")
            result = client.rpc("tools/call", {"name": args.tool, "arguments": arguments})
            if result.get("isError"):
                raise ValueError("tool reported an error; inspect the official client or check its schema")
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except HTTPError as exc:
        parser.exit(2, f"Official MCP HTTP error {exc.code}; check authentication/rate limit.\n")
    except (URLError, TimeoutError, OSError):
        parser.exit(2, "Could not reach the official MCP endpoint; check network and local files.\n")
    except (KeyError, TypeError, ValueError):
        parser.exit(2, "MCP input or response is invalid; check token setup and the current tool schema.\n")


if __name__ == "__main__":
    main()
