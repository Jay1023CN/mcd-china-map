"""Read the complete public FDA CSV ZIP and retain only McDonald's operator rows."""
import collections
import csv
import datetime
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

SOURCE = "https://data.fda.gov.tw/data/opendata/export/97/csv"
BASE = Path(__file__).resolve().parent


def main():
    request = urllib.request.Request(SOURCE, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=90) as response:
        archive = response.read(80 * 1024 * 1024 + 1)
    if len(archive) > 80 * 1024 * 1024:
        raise ValueError("Public archive exceeds the 80 MB read ceiling")
    matches = []
    total = 0
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        for member in zipped.infolist():
            if not member.filename.lower().endswith(".csv"):
                continue
            with zipped.open(member) as stream:
                reader = csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig"))
                for row in reader:
                    total += 1
                    if row["公司統一編號"].strip() == "12411160":
                        matches.append(row)
    metadata = {
        "source_url": SOURCE,
        "dataset_page": "https://data.gov.tw/dataset/8938",
        "operator_brand_source": "https://www.mcdonalds.com/tw/zh-tw/privacy-policy.html",
        "operator_tax_source": "https://findbiz.nat.gov.tw/fts/company/12411160",
        "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "zip_sha256": hashlib.sha256(archive).hexdigest(),
        "zip_bytes": len(archive),
        "total_source_rows": total,
        "coverage_complete": False,
        "current_open_status_verified": False,
        "brand_store_names_available": False,
        "coordinates_available": False,
    }
    candidates = dict(metadata, filter_rule="公司統一編號=12411160", rows=matches)
    (BASE / "taiwan-food-registration-candidates.json").write_text(
        json.dumps(candidates, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    restaurants = [r for r in matches if r["登錄項目"] == "餐飲場所"]
    addresses = collections.Counter(r["業者地址"] for r in restaurants)
    result = dict(
        metadata,
        filter_rule="公司統一編號=12411160 and 登錄項目=餐飲場所",
        row_count=len(restaurants),
        unique_registration_ids=len({r["食品業者登錄字號"] for r in restaurants}),
        unique_addresses=len(addresses),
        duplicate_addresses=[{"address": k, "count": v} for k, v in addresses.items() if v > 1],
        scope_note="完整公开登记数据中和德昌餐饮场所，不保证均为当前营业品牌门店。原公司名称及地址不得冒充核实过的品牌分店名。",
        rows=restaurants,
    )
    (BASE / "taiwan-food-restaurant-registration.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({"total": total, "restaurant_rows": len(restaurants), "unique_addresses": len(addresses)}))


if __name__ == "__main__":
    main()
