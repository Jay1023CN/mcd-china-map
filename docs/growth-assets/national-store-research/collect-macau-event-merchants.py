"""Collect the anonymous merchant search used by the 2026 ZAPE festival page."""
import hashlib
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PAGE = "https://file.findmacau.com/app/findmacau_h5/newfindings/macau-zape-fest-2026.html"
SCRIPT = urllib.parse.urljoin(PAGE, "macau-zape-fest-2026.js")


def get(url):
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": PAGE})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def main():
    page = get(PAGE)
    script = get(SCRIPT)
    text = script.decode("utf-8")
    assert "macau-zape-fest-2026.js" in page.decode("utf-8")
    base = re.search(r'baseAPIURL\s*=\s*"([^"]+)"', text).group(1)
    assert "/find/shop/consumer/search" in text
    url = base + "/find/shop/consumer/search?" + urllib.parse.urlencode(
        {"language": "taiwan", "keywords": "麥當勞"}
    )
    body = get(url)
    payload = json.loads(body)
    assert payload["header"]["status"] == 200
    directory = json.loads((ROOT / "macau-directory-cross-check.json").read_text(encoding="utf-8"))["rows"]
    by_phone = {row["phone"]: row for row in directory}
    rows = []
    for item in payload["data"]["list"]:
        assert "麥當勞" in item["shop_name"] and item["address"]
        phone = re.sub(r"\D", "", item["tel"])
        if phone.startswith("00853"):
            phone = phone[5:]
        assert len(phone) == 8
        old = by_phone.get(phone)
        rows.append({
            "name": item["shop_name"], "address": item["address"], "phone": phone,
            "source_url": PAGE, "data_url": url,
            "source_type": "public_event_participating_merchant_directory",
            "directory_phone_match": old["name"] if old else None,
            "directory_phone_match_unique": bool(old),
            "coordinates_as_published": {"lat": item["lat"], "lon": item["lon"]},
            "coordinate_reference_system_verified": False,
            "physical_current_operation_verified": False,
        })
    assert len({row["phone"] for row in rows}) == len(rows)
    output = {
        "source_url": PAGE, "script_url": SCRIPT, "data_url": url,
        "source_type": "public_event_participating_merchant_directory",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "page_sha256": hashlib.sha256(page).hexdigest(),
        "script_sha256": hashlib.sha256(script).hexdigest(),
        "response_sha256": hashlib.sha256(body).hexdigest(),
        "query": {"language": "taiwan", "keywords": "麥當勞"},
        "row_count": len(rows), "directory_phone_matches": sum(bool(r["directory_phone_match"]) for r in rows),
        "brand_entire_region_coverage_verified": False,
        "scope_note": "普通页面JS使用的匿名商户查询，不需登录。活动合作平台目录，不冒充品牌或政府门店名册；公布坐标未确认坐标系，不直接用于导航。",
        "rows": rows,
    }
    path = ROOT / "macau-event-merchant-snapshot.json"
    path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"rows": len(rows), "phone_matches": output["directory_phone_matches"], "path": str(path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
