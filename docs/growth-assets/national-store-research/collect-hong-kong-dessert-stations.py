"""Collect all addresses in the brand-linked public dessert-station list.

Only exact complete-address matches link stations to existing restaurant IDs.
Unmatched addresses are retained as evidence, not declared additional branches.
"""
import collections
import datetime
import hashlib
import json
from pathlib import Path
import re
import unicodedata
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
FAQ = "https://www.mcdonalds.com.hk/faqs/about-dessert-kiosk/dessert-kiosk-address"
SHORT = "https://mcds.hk/dkaddresslist"


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.url, response.read()


def normalize(address):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", address))


def main():
    final_url, page = fetch(SHORT)
    script_match = re.search(r'<script\b[^>]*src="([^"]*/dk\.js)"', page.decode("utf-8"))
    if not script_match:
        raise ValueError("Brand-linked page no longer contains its dessert-list script")
    script_url, script = fetch(urllib.parse.urljoin(final_url, script_match[1]))
    data_match = re.search(r"fetch\(['\"]([^'\"]+)['\"]\)", script.decode("utf-8"))
    if not data_match:
        raise ValueError("Dessert-list fetch was not found in the published script")
    data_url = urllib.parse.urljoin(final_url, data_match[1])
    _, payload = fetch(data_url)
    data = json.loads(payload)
    expected = {"hk", "kowloon", "nt", "island"}
    if set(data) != expected:
        raise ValueError("Published area keys changed; inspect before exporting")
    restaurants = json.loads((ROOT / "hong-kong-official-snapshot.json").read_text(encoding="utf-8"))["stores"]
    by_address = collections.defaultdict(list)
    for restaurant in restaurants:
        by_address[normalize(restaurant["address"])].append(restaurant)
    rows = []
    for region, addresses in data.items():
        for address in addresses:
            if not isinstance(address, str) or not address.strip():
                raise ValueError("Invalid published address")
            matches = by_address[normalize(address)]
            row = {"region": region, "address": address, "source_type": "official_dessert_station_address",
                   "source_url": data_url, "physical_current_operation_verified": False,
                   "identity_status": "unresolved_parent_restaurant"}
            if len(matches) == 1:
                row.update(identity_status="unique_exact_complete_address_match",
                           restaurant_rid=matches[0]["rid"], restaurant_name=matches[0]["name"],
                           restaurant_address=matches[0]["address"])
            rows.append(row)
    unique_addresses = len({normalize(row["address"]) for row in rows})
    exact = sum(row["identity_status"] == "unique_exact_complete_address_match" for row in rows)
    output = {"source_type": "official_brand_dessert_station_list", "faq_url": FAQ,
              "short_url": SHORT, "resolved_page_url": final_url, "script_url": script_url,
              "source_url": data_url, "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "response_sha256": hashlib.sha256(payload).hexdigest(), "published_area_counts": {key: len(value) for key, value in data.items()},
              "row_count": len(rows), "unique_addresses": unique_addresses,
              "unique_exact_restaurant_address_matches": exact,
              "unresolved_parent_restaurant_addresses": len(rows) - exact,
              "full_published_json_collected": True, "added_store_count": 0,
              "scope_note": "All published station-address rows collected. An address spelling or floor difference is not proof of a new independent restaurant. No station is automatically counted as a new branch. Preserve complete unit and floor numbers; do not fuzzy-match for identity.",
              "rows": rows}
    path = ROOT / "hong-kong-official-dessert-station-snapshot.json"
    path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"rows": len(rows), "exact_existing_restaurant_matches": exact,
                      "unresolved": len(rows) - exact, "output": str(path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
