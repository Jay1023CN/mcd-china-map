"""Read public ferry shop pages; retain McDonald's evidence only."""
import hashlib
import html
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INDEX = "https://www.marine.gov.mo/shop.aspx"
TAIPA = INDEX + "?local=TP&port=ALL"


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as response:
        return response.read()


def anchors(body):
    return [(html.unescape(m[0]), html.unescape(re.sub(r"<[^>]+>", "", m[1])).strip())
            for m in re.findall(r'<a[^>]+href=["\x27]([^"\x27]+)["\x27][^>]*>(.*?)</a>', body.decode("utf-8"), re.S)]


def main():
    index = get(INDEX)
    links = [(href, name) for href, name in anchors(index) if "shop_detail.aspx" in href and "麥當勞" in name]
    assert len(links) == 1
    url = urllib.parse.urljoin(INDEX, links[0][0])
    detail = get(url)
    text = html.unescape(re.sub(r"<[^>]+>", " ", detail.decode("utf-8")))
    text = re.sub(r"\s+", " ", text)
    phone = re.search(r"電話:\s*\(853\)\s*(\d{4})\s*(\d{4})", text)
    assert phone and "".join(phone.groups()) == "28703031"
    location = re.search(r"位置:\s*(.*?)\s*分類:", text)[1]
    hours = re.search(r"服務時間:\s*([0-9:]+-[0-9:]+)", text)[1]
    assert "3006" in location and "公眾區域" in location
    taipa = get(TAIPA)
    taipa_links = [(href, name) for href, name in anchors(taipa) if "shop_detail.aspx" in href]
    matches = [(href, name) for href, name in taipa_links if "麥當勞" in name or "mcdonald" in name.lower()]
    output = {
        "source_type": "official_venue_public_visitor_listing", "source_url": INDEX,
        "fetched_at": datetime.now(timezone.utc).isoformat(), "index_sha256": hashlib.sha256(index).hexdigest(),
        "row_count": 1, "added_store_count": 0, "brand_entire_region_coverage_verified": False,
        "rows": [{"directory_name": "麥當勞（外港碼頭店）", "directory_phone": "28703031",
                  "source_url": url, "source_type": "official_venue_public_visitor_listing",
                  "response_sha256": hashlib.sha256(detail).hexdigest(),
                  "visitor_location": location, "visitor_address": "澳門外港客運碼頭 " + location,
                  "opening_hours_as_published": hours, "phone_as_published": "(853) 2870 3031",
                  "match_method": "unique_published_phone_and_existing_directory_phone",
                  "live_page_facts_verified": True, "physical_current_operation_verified": False}],
        "taipa_terminal_follow_up": {"source_url": TAIPA, "response_sha256": hashlib.sha256(taipa).hexdigest(),
                                     "rendered_shop_link_count": len(taipa_links), "named_brand_shop_links": len(matches),
                                     "closed_status_verified": False,
                                     "note": "当前场地方氹仔分区没列麦当劳。历史店不能据缺项直接删掉或认定结业，也不能混作外港3006。"},
    }
    (ROOT / "macau-ferry-venue-snapshot.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"matched_phone": "28703031", "location": location, "hours": hours, "taipa_brand_links": len(matches)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
