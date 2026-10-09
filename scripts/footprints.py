#!/usr/bin/env python3
"""Read-only, deterministic aggregates of explicitly normalized order records.

MCP adapters must check the actual official schema before mapping order statuses.
This module never authenticates, calls MCP, or infers that an order was eaten.
"""

import argparse
from collections import Counter, defaultdict
from datetime import datetime
import json
import os
from pathlib import Path
import re
import sys


class InputError(ValueError):
    """The normalized input cannot be interpreted without guessing."""


def _text(value, field, optional=False):
    if optional and value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise InputError(f"{field} must be a nonempty string")
    # Public display labels cannot introduce HTML or terminal control characters.
    text = re.sub(r"[\x00-\x1f\x7f]", " ", value).strip()
    if len(text) > 1000:
        raise InputError(f"{field} must be at most 1000 characters")
    return text.replace("<", "〈").replace(">", "〉")


def _integer(value, field, minimum=0):
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise InputError(f"{field} must be an integer >= {minimum}")
    return value


def _datetime(value, field):
    if not isinstance(value, str):
        raise InputError(f"{field} must be an ISO datetime with timezone")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise InputError(f"{field} must be an ISO datetime with timezone") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise InputError(f"{field} must include a timezone")
    return parsed


def build_summary(payload):
    """Return a public aggregate with no order IDs, store IDs, or timestamps.

    Amounts are integer fen (paid_cents). Only normalized ``completed`` records
    contribute to stores, monthly counts, items, collaborations, and money.
    Input timezone determines the order's calendar year and month.
    """
    if not isinstance(payload, dict):
        raise InputError("input must be an object")
    year = _integer(payload.get("year"), "year", 1900)
    if year > 9999:
        raise InputError("year must be <= 9999")
    source = payload.get("source")
    if not isinstance(source, dict) or source.get("kind") not in ("synthetic", "mcp"):
        raise InputError("source.kind must be synthetic or mcp")
    retrieved_at = source.get("retrieved_at")
    _datetime(retrieved_at, "source.retrieved_at")
    tools = source.get("tools")
    allowed_tools = {"order-list", "query-order", "now-time-info"}
    if not isinstance(tools, list) or not tools or not all(isinstance(x, str) and x in allowed_tools for x in tools):
        raise InputError("source.tools must be a nonempty list of order-list/query-order/now-time-info")
    coverage = source.get("coverage")
    if not isinstance(coverage, dict) or type(coverage.get("complete")) is not bool:
        raise InputError("source.coverage.complete must be a boolean")
    description = _text(coverage.get("description"), "source.coverage.description")
    orders = payload.get("orders")
    if not isinstance(orders, list):
        raise InputError("orders must be a list")

    warning_counts = Counter()
    seen = {}
    validated = []
    for index, order in enumerate(orders):
        field = f"orders[{index}]"
        if not isinstance(order, dict):
            raise InputError(f"{field} must be an object")
        identifier = order.get("id")
        if not isinstance(identifier, str) or not identifier.strip():
            raise InputError(f"{field}.id must be a nonempty opaque string")
        _datetime(order.get("created_at"), f"{field}.created_at")
        if order.get("status") not in ("completed", "cancelled", "pending", "unknown"):
            raise InputError(f"{field}.status must be explicitly normalized")
        store = order.get("store")
        if not isinstance(store, dict):
            raise InputError(f"{field}.store must be an object")
        if store.get("id") is not None:
            if not isinstance(store["id"], str) or not store["id"].strip():
                raise InputError(f"{field}.store.id must be a nonempty string when present")
        _text(store.get("name"), f"{field}.store.name")
        _text(store.get("city"), f"{field}.store.city", optional=True)
        if "paid_cents" in order:
            _integer(order["paid_cents"], f"{field}.paid_cents")
        items = order.get("items")
        if not isinstance(items, list):
            raise InputError(f"{field}.items must be a list")
        for item in items:
            if not isinstance(item, dict):
                raise InputError(f"{field}.items must contain objects")
            _text(item.get("name"), f"{field}.item.name")
            _integer(item.get("quantity"), f"{field}.item.quantity", 1)
            if item.get("collaboration") is not None:
                _text(item["collaboration"], f"{field}.item.collaboration")
        if identifier in seen:
            if order != seen[identifier]:
                raise InputError("conflicting duplicate order records; reconcile source data first")
            warning_counts["duplicate_orders_removed"] += 1
            continue
        seen[identifier] = order
        validated.append(order)

    scoped = [o for o in validated if _datetime(o["created_at"], "created_at").year == year]
    statuses = Counter(o["status"] for o in scoped)
    completed = [o for o in scoped if o["status"] == "completed"]
    monthly = [{"month": f"{year}-{m:02d}", "completed_orders": 0,
                "paid_cents_known": 0, "paid_orders_known": 0,
                "paid_orders_unknown": 0} for m in range(1, 13)]
    stores = {}
    store_labels = defaultdict(set)
    city_orders = Counter()
    city_stores = defaultdict(set)
    item_quantities = Counter()
    collaboration_orders = Counter()
    collaboration_quantities = Counter()
    money = 0
    known_money = 0
    missing_store = 0
    missing_city = 0
    for order in completed:
        month = monthly[_datetime(order["created_at"], "created_at").month - 1]
        month["completed_orders"] += 1
        if "paid_cents" in order:
            known_money += 1
            money += order["paid_cents"]
            month["paid_orders_known"] += 1
            month["paid_cents_known"] += order["paid_cents"]
        else:
            month["paid_orders_unknown"] += 1
        store = order["store"]
        name = _text(store["name"], "store.name")
        city = _text(store.get("city"), "store.city", optional=True)
        if city is None:
            missing_city += 1
        else:
            city_orders[city] += 1
        store_id = store.get("id")
        if store_id is None:
            missing_store += 1
        else:
            store_labels[store_id].add((name, city))
            if store_id not in stores:
                stores[store_id] = {"name": name, "city": city,
                                    "completed_orders": 0, "item_quantity": 0}
            elif (stores[store_id]["name"], stores[store_id]["city"]) != (name, city):
                # Choosing a deterministic display label does not change identity.
                old = stores[store_id]
                old["name"], old["city"] = min(
                    [(old["name"], old["city"]), (name, city)],
                    key=lambda pair: (pair[0], pair[1] or ""))
            stores[store_id]["completed_orders"] += 1
            if city is not None:
                city_stores[city].add(store_id)
        order_collaborations = set()
        for item in order["items"]:
            quantity = item["quantity"]
            item_quantities[_text(item["name"], "item.name")] += quantity
            if store_id is not None:
                stores[store_id]["item_quantity"] += quantity
            collaboration = item.get("collaboration")
            if collaboration is None:
                continue
            if item.get("collaboration_source") not in ("official", "user_confirmed"):
                warning_counts["unverified_collaboration_ignored"] += 1
                continue
            label = _text(collaboration, "item.collaboration")
            order_collaborations.add(label)
            collaboration_quantities[label] += quantity
        collaboration_orders.update(order_collaborations)

    varying_labels = sum(len(labels) > 1 for labels in store_labels.values())
    if varying_labels:
        warning_counts["store_labels_vary"] = varying_labels
    if not coverage["complete"]:
        warning_counts["partial_coverage"] = 1
    if missing_store:
        warning_counts["missing_store_id"] = missing_store
    if missing_city:
        warning_counts["missing_city"] = missing_city
    unknown_money = len(completed) - known_money
    if unknown_money:
        warning_counts["missing_paid_amount"] = unknown_money
    messages = {
        "duplicate_orders_removed": "相同订单重复记录已去重。",
        "store_labels_vary": "同一官方门店 ID 的显示名称或城市不同，门店仍按 ID 计数。",
        "unverified_collaboration_ignored": "缺少官方或用户核验依据的联名标签未计入。",
        "partial_coverage": "仅统计实际获取范围，不能作为完整年度消费记录。",
        "missing_store_id": "缺少官方门店 ID 的完成订单未计入不同门店数。",
        "missing_city": "部分完成订单未提供城市，城市统计不完整。",
        "missing_paid_amount": "部分完成订单未提供实付金额，已知金额合计不代表完整支出。",
    }
    public_coverage = {"complete": coverage["complete"], "description": description,
                       "scope_label": "完整年度记录" if coverage["complete"] else "已获取订单范围"}
    return {
        "schema_version": 1, "year": year, "data_kind": source["kind"],
        "title": f"{year} 麦麦轨迹｜{public_coverage['scope_label']}",
        "source": {"kind": source["kind"], "tools": sorted(set(_text(t, "tool") for t in tools)),
                   "retrieved_at": retrieved_at, "coverage": dict(public_coverage)},
        "coverage": public_coverage,
        "summary": {"completed_orders": statuses["completed"],
                    "cancelled_orders": statuses["cancelled"],
                    "pending_orders": statuses["pending"],
                    "unknown_status_orders": statuses["unknown"],
                    "distinct_stores": len(stores), "orders_missing_store_id": missing_store,
                    "cities": len(city_orders), "orders_missing_city": missing_city,
                    "paid_cents_known": money, "paid_orders_known": known_money,
                    "paid_orders_unknown": unknown_money,
                    "item_quantity": sum(item_quantities.values())},
        "monthly": monthly,
        "stores": sorted(stores.values(), key=lambda s: (-s["completed_orders"], s["name"], s["city"] or "")),
        "cities": [{"name": city, "completed_orders": count,
                    "distinct_stores": len(city_stores[city])}
                   for city, count in sorted(city_orders.items(), key=lambda p: (-p[1], p[0]))],
        "collaborations": [{"name": name, "completed_orders": count,
                            "item_quantity": collaboration_quantities[name]}
                           for name, count in sorted(collaboration_orders.items(), key=lambda p: (-p[1], p[0]))],
        "items": [{"name": name, "quantity": count}
                  for name, count in sorted(item_quantities.items(), key=lambda p: (-p[1], p[0]))],
        "warnings": [{"code": code, "message": messages[code], "count": count}
                     for code, count in sorted(warning_counts.items())],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="汇总麦麦订单轨迹，不连接 MCP、不修改订单。")
    parser.add_argument("input", type=Path, help="已规范化的订单 JSON")
    parser.add_argument("-o", "--output", type=Path, help="公开聚合 JSON 的输出路径")
    args = parser.parse_args(argv)
    try:
        payload = json.loads(args.input.read_text(encoding="utf-8"))
        rendered = json.dumps(build_summary(payload), ensure_ascii=False, indent=2) + "\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                os.fchmod(handle.fileno(), 0o600)
                handle.write(rendered)
        else:
            sys.stdout.write(rendered)
    except (InputError, OSError, json.JSONDecodeError) as exc:
        # Errors reference schema locations, never print source records or IDs.
        parser.exit(2, f"footprints: {exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
