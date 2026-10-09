#!/usr/bin/env python3
"""Normalize observed official MCP responses without copying private fields."""
import argparse
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
import re

from connect_mcp import save_private
from footprints import InputError, build_summary


def read_result(path):
    envelope = json.loads(path.read_text(encoding='utf-8'))
    response = envelope.get('structuredContent')
    if envelope.get('isError') or not isinstance(response, dict) or response.get('success') is not True:
        raise InputError('response must contain successful official structuredContent')
    return response['data']


def explicit_city(address):
    # Only literal administrative city names in official restaurant addresses.
    if not isinstance(address, str):
        return None
    direct = re.match(r'^(北京市|上海市|天津市|重庆市)', address.strip())
    if direct:
        return direct.group(1)
    provincial = re.match(r'^[\u4e00-\u9fff]{2,8}?(?:省|自治区)([\u4e00-\u9fff]{2,8}?市)', address.strip())
    return provincial.group(1) if provincial else None


def normalize(directory, order_offset):
    time_data = read_result(directory / 'now-time-info.result.json')
    offset = order_offset
    if not re.fullmatch(r'[+-](?:0\d|1[0-4]):[0-5]\d', offset):
        raise InputError('explicit order offset must be formatted +HH:MM or -HH:MM')
    listing = read_result(directory / 'order-list.result.json')
    rows = listing['list']
    if not isinstance(rows, list):
        raise InputError('order-list data.list must be a list')
    details = {}
    for path in directory.glob('order-detail-*.json'):
        detail = read_result(path)
        if detail.get('orderId') in details and details[detail['orderId']] != detail:
            raise InputError('conflicting order detail responses')
        details[detail['orderId']] = detail
    orders = []
    for row in rows:
        detail = details.get(row['orderId'])
        data = detail or row
        created = datetime.fromisoformat(data['createTime'].replace('Z', '+00:00'))
        if created.tzinfo is None:
            created = datetime.fromisoformat(created.isoformat() + offset)
        # Observed responses contain textual orderStatus and an undocumented
        # numeric status field. Do not apply the contradictory documented enum.
        status_label = data.get('orderStatus')
        status = {'订单已完成': 'completed', '订单已取消': 'cancelled'}.get(status_label, 'unknown')
        store = {'name': data.get('storeName') or row['storeName']}
        if row.get('storeCode'):
            store['id'] = row['storeCode']
        city = explicit_city(data.get('storeAddress')) if detail else None
        if city:
            store['city'] = city
        order = {'id': row['orderId'], 'created_at': created.isoformat(), 'status': status, 'store': store,
                 'items': [{'name': p['productName'], 'quantity': p['quantity']} for p in data.get('orderProductList', [])]}
        # Only query-order's field description confirms this is actual payment.
        if detail and detail.get('realTotalAmount') not in (None, ''):
            amount = Decimal(detail['realTotalAmount']) * 100
            if not amount.is_finite() or amount < 0 or amount != amount.to_integral_value():
                raise InputError('actual paid amount must be nonnegative whole cents')
            order['paid_cents'] = int(amount)
        orders.append(order)
    received = datetime.fromtimestamp((directory/'order-list.result.json').stat().st_mtime, timezone.utc).isoformat()
    payload = {'year': time_data['year'], 'source': {'kind': 'mcp', 'tools': ['order-list', 'query-order', 'now-time-info'] if details else ['order-list', 'now-time-info'],
               'retrieved_at': received, 'coverage': {'complete': False,
               'description': f'仅统计官方本次返回的近期订单，不能确认全年覆盖。无偏移的下单时间按操作方明确指定的 {offset} 解析；原始时间字段未声明时区。套餐只计主项，不重复累加子项。'}}, 'orders': orders}
    benefit_entries, benefit_tools, benefit_times = [], [], []
    coupon_path = directory / 'available-coupons.result.json'
    if coupon_path.exists():
        coupons = read_result(coupon_path)
        if not isinstance(coupons, list):
            raise InputError('available-coupons data must be a list')
        for coupon in coupons:
            benefit_entries.append({'kind': 'coupon', 'title': coupon['couponName'],
                                    'details': '；'.join(str(v) for v in [coupon.get('couponStatus'), coupon.get('label')] if v) or '官方本次返回的可领券，具体使用条件请查看官方详情。'})
        benefit_tools.append('available-coupons')
        benefit_times.append(coupon_path.stat().st_mtime)
    campaign_path = directory / 'campaign-calendar.result.json'
    if campaign_path.exists():
        campaigns = read_result(campaign_path)
        for day in campaigns['dailyList']:
            for event in day['events']:
                title = event.get('activityTitle')
                if not title:
                    continue
                details_text = event.get('activitySubTitle') or event.get('activityTag') or '官方活动日历记录，核对活动详情后参与。'
                benefit_entries.append({'kind': 'campaign', 'title': title, 'details': details_text,
                                        'validity': f'日历标注日期：{day["date"]}。不代表完整有效期，可能是往期或未来活动。'})
        benefit_tools.append('campaign-calendar')
        benefit_times.append(campaign_path.stat().st_mtime)
    if benefit_tools:
        payload['benefits'] = {'source': {'kind': 'mcp', 'tools': benefit_tools,
                               'retrieved_at': datetime.fromtimestamp(max(benefit_times), timezone.utc).isoformat()}, 'entries': benefit_entries}
    build_summary(payload)
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--response-dir', type=Path, default=Path(__file__).resolve().parents[1] / 'private/mcp')
    parser.add_argument('--order-offset', required=True, help='explicit interpretation of order timestamps without timezone; e.g. +08:00')
    args = parser.parse_args()
    try:
        payload = normalize(args.response_dir, args.order_offset)
        path = save_private('footprints.normalized.json', payload)
        print(path)
        print('Normalized real MCP responses; original identifiers remain in the private input only.')
    except (ValueError, KeyError, TypeError, OSError, InvalidOperation):
        parser.exit(2, 'Cannot normalize current responses; inspect the observed schema locally. No source values printed.\n')


if __name__ == '__main__':
    main()
