"""Cross-check existing Macau rows against public venue-operated visitor pages.

No new restaurants are inferred. License addresses and visitor locations are
different evidence: a fetched website is not a physical operating-status check.
"""
import concurrent.futures
import datetime
import hashlib
import html
import json
from pathlib import Path
import re
import urllib.request

ROOT = Path(__file__).resolve().parent
RULES = [
    dict(phone="28827110", url="https://www.galaxymacau.com/zh-hant/dining/restaurants/mcdonald/",
         required=["麥當勞", "時尚大道東G017", "+853 2882 7110", "上午8時至凌晨12時"],
         location="時尚大道東G017", visitor_address="澳門銀河綜合度假城時尚大道東G017",
         hours="08:00–00:00", match_method="unique_exact_phone_on_venue_page"),
    dict(phone="28852665", url="https://www.studiocity-macau.com/sc/dining/mcdonalds",
         required=["麦当劳", "2楼2088号", "2885 2665", "08:00 - 24:00"],
         location="2樓2088號", visitor_address="澳門新濠影匯2樓2088號",
         hours="08:00–24:00", match_method="unique_exact_phone_on_venue_page"),
    dict(phone="28319533", url="https://www.cityofdreamsmacau.com/kr/dining/mcdonalds",
         required=["McDonald", "City of Dreams SOHO 2층", "2831 9533", "08:00 - 24:00"],
         location="新濠天地SOHO 2樓", visitor_address="澳門新濠天地SOHO 2樓",
         hours="08:00–24:00", match_method="unique_exact_phone_on_venue_page"),
    dict(phone="28861550", url="https://www.macau-airport.com/cn/dining/mcdonalds",
         required=["麦当劳 候机楼阁楼层非禁区空间编号01-02-0009 06:00 - 22:00"],
         location="候機樓閣樓層非禁區空間編號01-02-0009",
         visitor_address="澳門國際機場候機樓閣樓層非禁區空間編號01-02-0009",
         hours="06:00–22:00", match_method="existing_unique_airport_branch_and_named_venue_listing"),
    dict(phone="28840788", url="https://css.cmdo.um.edu.mo/outlets/?lang=zh-hant",
         required=["麥當勞 S1 研究生宿舍 07:00 – 23:00", "更新於2026年9月25日"],
         location="S1研究生宿舍", visitor_address="澳門大學S1研究生宿舍",
         hours="07:00–23:00", page_list_updated="2026-09-25",
         match_method="existing_unique_university_branch_and_named_venue_listing"),
    dict(phone="28725306", url="https://www.sandsmacao.com/dining/mcdonalds.html",
         required=["McDonald's", "Shop L101, 1/F, Sands Macao", "12:00pm – 6:00pm"],
         location="澳門金沙1樓L101號舖", visitor_address="澳門金沙1樓L101號舖",
         hours="12:00–18:00", match_method="existing_unique_sands_branch_and_named_venue_listing"),
]


def collect(rule, directory):
    request = urllib.request.Request(rule["url"], headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = response.read()
        final_url = response.url
    text = payload.decode("utf-8", "replace")
    text = re.sub(r"<script\b[^>]*>.*?</script>|<style\b[^>]*>.*?</style>", " ", text,
                  flags=re.S | re.I)
    text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text)))
    missing = [phrase for phrase in rule["required"] if phrase not in text]
    if missing:
        raise ValueError(f"Visitor facts changed at {rule['url']}: {missing}")
    matches = [row for row in directory if row["phone"] == rule["phone"]]
    if len(matches) != 1:
        raise ValueError(f"Directory phone match is not unique: {rule['phone']}")
    existing = matches[0]
    result = {
        "directory_name": existing["name"],
        "directory_phone": existing["phone"],
        "source_type": "official_venue_visitor_listing",
        "source_url": rule["url"], "resolved_url": final_url,
        "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "response_sha256": hashlib.sha256(payload).hexdigest(),
        "visitor_location": rule["location"], "visitor_address": rule["visitor_address"],
        "opening_hours_as_published": rule["hours"],
        "match_method": rule["match_method"],
        "live_page_facts_verified": True,
        "physical_current_operation_verified": False,
        "directory_address": existing["address"],
    }
    if "page_list_updated" in rule:
        result["page_list_updated"] = rule["page_list_updated"]
    if "government_license_match" in existing:
        result["license_address"] = existing["government_license_match"]["address"]
        result["license_source_url"] = existing["government_license_match"]["source_url"]
    if rule["phone"] == "28827110":
        result["address_conflict"] = {
            "visitor_unit": "G017", "registered_unit": "G35",
            "resolution": "Use venue visitor listing for finding the restaurant; retain license address separately. Neither is proof of a move or a second branch.",
        }
    return result


def main():
    directory = json.loads((ROOT / "macau-directory-cross-check.json").read_text(encoding="utf-8"))["rows"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        rows = list(pool.map(lambda rule: collect(rule, directory), RULES))
    document = {
        "source_type": "official_venue_visitor_cross_check",
        "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "row_count": len(rows), "coverage_complete": False, "added_store_count": 0,
        "scope_note": "Existing branches cross-checked against venue visitor pages. Published hours are not a physical visit or live trading guarantee. Do not deduplicate or add branches from different registered/visitor unit numbers.",
        "rows": rows,
    }
    path = ROOT / "macau-official-venue-cross-check.json"
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(path), "rows": len(rows), "added_stores": 0}, ensure_ascii=False))


if __name__ == "__main__":
    main()
