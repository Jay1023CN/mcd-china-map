"""Read the public dining JSON explicitly linked by Lisboeta's visitor page."""
import hashlib
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PAGE = "https://www.lisboetamacau.com/zh-hant/dining/venues/mcdonalds/"


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as response:
        return response.read()


def main():
    page = get(PAGE)
    links = re.findall(r'<link[^>]+type="application/json"[^>]+href="([^"]+)"', page.decode("utf-8"))
    assert len(links) == 1 and links[0].startswith("https://www.lisboetamacau.com/zh-hant/wp-json/wp/v2/dining/")
    body = get(links[0])
    post = json.loads(body)
    assert post["status"] == "publish" and post["slug"] == "mcdonalds"
    items = {item["type"]: item["content"] for item in post["acf"]["general_information"]["items"]}
    phone = re.sub(r"\D", "", items["phone"])
    assert phone == "85328870082" and "F07" in items["location"]
    directory = json.loads((ROOT / "macau-directory-cross-check.json").read_text(encoding="utf-8"))["rows"]
    matches = [r for r in directory if r["phone"] == phone[3:]]
    assert len(matches) == 1
    output = {
        "source_url": PAGE, "data_url": links[0], "source_type": "official_venue_public_visitor_listing",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "page_sha256": hashlib.sha256(page).hexdigest(), "response_sha256": hashlib.sha256(body).hexdigest(),
        "published_modified_at": post["modified_gmt"] + "Z", "added_store_count": 0,
        "row_count": 1, "brand_entire_region_coverage_verified": False,
        "scope_note": "页面HTML明确链接的公开JSON；只保存具名门店访客事实和来源，不保存WP作者/后台字段。发布时间不代表今日实时在营。",
        "rows": [{
            "directory_name": matches[0]["name"], "directory_phone": phone[3:],
            "directory_address": matches[0]["address"], "source_url": PAGE, "data_url": links[0],
            "source_type": "official_venue_public_visitor_listing", "visitor_location": items["location"],
            "visitor_address": "澳門葡京人 " + items["location"],
            "opening_hours_as_published": items["openingHours"], "phone_as_published": items["phone"],
            "match_method": "unique_published_phone_and_existing_directory_phone",
            "live_page_facts_verified": True, "physical_current_operation_verified": False,
        }],
    }
    (ROOT / "macau-lisboeta-venue-snapshot.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"rows": 1, "matched_phone": phone[3:], "visitor_location": items["location"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
