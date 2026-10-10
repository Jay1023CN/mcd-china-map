"""Extract the public restaurant list embedded in the official Hong Kong page."""
import datetime
import json
from pathlib import Path
import re
import sys
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')
URL = 'https://www.mcdonalds.com.hk/find-a-restaurant/'
req = urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=30) as rsp:
    content = rsp.read().decode('utf-8')
restaurants = None
for raw in re.findall(r'self\.__next_f\.push\((\[.*?\])\)</script>', content, re.S):
    batch = json.loads(raw)
    if len(batch) > 1 and isinstance(batch[1], str) and '"restaurants":' in batch[1]:
        stream = batch[1]
        pos = stream.index('"restaurants":') + len('"restaurants":')
        restaurants = json.JSONDecoder().raw_decode(stream[pos:])[0]
        break
if restaurants is None:
    raise SystemExit('Official restaurant array absent')
visible_ids = re.findall(r'<div id="store-([^\"]+)"', content)
allowed = ('rid', 'storeNo', 'name', 'address', 'district', 'city', 'region',
           'lat', 'lng', 'phone', 'facilities', 'openingHours')
rows = [{k: r[k] for k in allowed if k in r} for r in restaurants]
report = {'source': URL, 'collected_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'rows': len(rows), 'rendered_cards': len(visible_ids),
          'unique_ids': len(set(r['rid'] for r in rows)),
          'rendered_ids_match': set(visible_ids) == set(r['rid'] for r in rows),
          'coordinate_source': 'Official restaurant page, Google Maps display; no conversion applied; coordinate system not independently confirmed',
          'stores': rows}
out = Path(__file__).parent / 'hong-kong-official-snapshot.json'
out.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps({k: v for k, v in report.items() if k != 'stores'}, ensure_ascii=False))
if not report['rendered_ids_match'] or report['unique_ids'] != len(rows):
    raise SystemExit(2)
