"""Read the IAM public food-premises name search and its normal 10-row pages.

The public Spring/JSF form needs its own anonymous session cookies; no login or
tokens are supplied. Persist only displayed restaurant names/addresses and page
checksums, never cookies, form state, or other businesses' records.
"""
import datetime
import hashlib
import html
import http.cookiejar
import json
import math
from pathlib import Path
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
SERVICES = "https://www.iam.gov.mo/data/onestopservice_c.json"
NAME = "麥當勞"
TABLE = "enquiryForm:licenceListGroup"


def plain(value):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value))).strip()


def main():
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    opener.addheaders = [("User-Agent", "Mozilla/5.0")]
    def get(url):
        with opener.open(url, timeout=30) as response:
            return response.url, response.read()
    _, service_bytes = get(SERVICES)
    services = json.loads(service_bytes)["data"]
    links = [row["link"] for row in services if row["title"] == "已領有市政署准照/登記證明的餐飲場所"]
    if len(links) != 1:
        raise ValueError("Official public licensed-premises link changed")
    source_url = links[0]
    action_url, page = get(source_url)
    page_text = page.decode("utf-8")
    state = html.unescape(re.search(r'name="javax.faces.ViewState"[^>]*value="([^"]+)"', page_text)[1])
    if 'id="enquiryForm:j_idt37"' not in page_text or "搜尋" not in page_text:
        raise ValueError("Public search form changed; inspect before continuing")
    base = [("enquiryForm", "enquiryForm"), ("enquiryForm:placeName_input", NAME),
            ("enquiryForm:placeName_hinput", NAME), ("enquiryForm:placeAddr_input", ""),
            ("enquiryForm:placeAddr_hinput", ""), ("enquiryForm:area", "M"),
            ("enquiryForm:area", "T"), ("enquiryForm:area", "C")]
    def post(parameters):
        nonlocal state
        request = urllib.request.Request(action_url,
            data=urllib.parse.urlencode(parameters + base + [("javax.faces.ViewState", state)]).encode(),
            headers={"Faces-Request": "partial/ajax", "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"})
        with opener.open(request, timeout=30) as response:
            payload = response.read()
        root = ET.fromstring(payload)
        updates = {entry.get("id"): entry.text or "" for entry in root.findall(".//update")}
        for key, value in updates.items():
            if "javax.faces.ViewState" in key:
                state = value
        return payload, updates
    payload, updates = post([("javax.faces.partial.ajax", "true"), ("javax.faces.source", "enquiryForm:j_idt37"),
                            ("javax.faces.partial.execute", "enquiryForm"),
                            ("javax.faces.partial.render", "enquiryForm:searchCriteria " + TABLE),
                            ("enquiryForm:j_idt37", "enquiryForm:j_idt37")])
    first_markup = updates[TABLE]
    counts = re.search(r"rows:(\d+),rowCount:(\d+),page:0", first_markup)
    if not counts:
        raise ValueError("Query did not produce a count-checked public table")
    size, expected = map(int, counts.groups())
    if size != 10 or not 0 < expected < 200:
        raise ValueError("Unexpected query size: do not export unrelated businesses")
    rows, checks = [], []
    def accept(markup, raw_payload, page_index):
        body = re.search(r'<tbody[^>]*>(.*?)</tbody>', markup, re.S)
        fragment = body[1] if body else markup
        captured = []
        for index, cells in re.findall(r'<tr\b[^>]*data-ri="(\d+)"[^>]*>(.*?)</tr>', fragment, re.S):
            values = [plain(cell) for cell in re.findall(r'<td\b[^>]*>(.*?)</td>', cells, re.S)]
            if len(values) != 2 or values[0] != NAME or not values[1]:
                raise ValueError("Unexpected restaurant name/address columns")
            captured.append({"name": values[0], "address": values[1], "source_row": int(index),
                             "source_page": page_index + 1, "source_url": source_url,
                             "source_type": "iam_public_licensed_food_premises_query",
                             "physical_current_operation_verified": False})
        wanted = min(size, expected - page_index * size)
        if len(captured) != wanted or [r["source_row"] for r in captured] != list(range(page_index * size, page_index * size + wanted)):
            raise ValueError("Missing or repeated query page rows")
        rows.extend(captured)
        checks.append({"page": page_index + 1, "rows": len(captured),
                       "response_sha256": hashlib.sha256(raw_payload).hexdigest()})
    accept(first_markup, payload, 0)
    for page_index in range(1, math.ceil(expected / size)):
        payload, updates = post([("javax.faces.partial.ajax", "true"), ("javax.faces.source", TABLE),
                                ("javax.faces.partial.execute", TABLE), ("javax.faces.partial.render", TABLE),
                                (TABLE, TABLE), (TABLE + "_pagination", "true"),
                                (TABLE + "_first", str(page_index * size)), (TABLE + "_rows", str(size)),
                                (TABLE + "_encodeFeature", "true")])
        accept(updates[TABLE], payload, page_index)
    output = {"source_url": source_url, "official_link_directory": SERVICES,
              "link_directory_response_sha256": hashlib.sha256(service_bytes).hexdigest(),
              "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "query": {"place_name": NAME, "areas": ["M", "T", "C"]},
              "published_query_total": expected, "row_count": len(rows), "pages": checks,
              "full_query_pagination_collected": len(rows) == expected,
              "brand_entire_region_coverage_verified": False,
              "scope_note": "All rows of the IAM public licensed/registered premises query for the exact displayed brand name. Cross-check Tourism licenses, alternate registered names and venue listings before claiming all Macau physical restaurants. Page publication is not a physical opening-status visit.",
              "rows": rows}
    target = ROOT / "macau-iam-license-snapshot.json"
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"rows": len(rows), "pages": len(checks), "full_query_pagination_collected": True}, ensure_ascii=False))


if __name__ == "__main__":
    main()
