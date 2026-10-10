"""Collect public Macau branch entries, retaining explicit source distinctions."""
import datetime
import hashlib
import html
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request

BASE = Path(__file__).resolve().parent
DIRECTORY = "https://www.yp.mo/business/" + urllib.parse.quote("澳門麥當勞餐廳") + ".html"
EVENT = "https://lum.macaotourism.gov.mo/data/stores.json"


def get(url):
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read()


def write(name, data):
    (BASE / name).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    response = get(DIRECTORY)
    text = html.unescape(re.sub("<[^>]*>", "\n", response.decode("utf-8")))
    start = text.index("麥當勞（水坑尾")
    section = text[start:text.index("分區：", start)].replace("\u200b", "")
    blocks = re.findall(r"(麥當勞\s*[（(][\s\S]*?)(?=麥當勞\s*[（(]|$)", section)
    rows = []
    for block in blocks:
        name = re.match(r"麥當勞\s*[（(]([\s\S]*?)[)）]", block)
        phone = re.search(r"(?:電話|Tel)\s*[：:]\s*([\d\s]{8,})", block)
        if not name or not phone:
            raise ValueError("Branch name or telephone parse failed; source layout needs review")
        address = block[name.end():phone.start()].strip()
        address = re.sub(r"^(?:地址\s*[：:]\s*)", "", address)
        address = re.sub(r"營業時間[\s\S]*$", "", address)
        rows.append({
            "name": "麥當勞（" + re.sub(r"\s+", "", name.group(1)) + "）",
            "address": re.sub(r"\s+", " ", address).strip(),
            "phone": re.sub(r"\s", "", phone.group(1)),
            "source_url": DIRECTORY,
            "source_type": "public_business_directory",
            "current_open_status_verified": False,
        })
    license_path = BASE / "macau-tourism-license-partial.json"
    if license_path.exists():
        licensed = json.loads(license_path.read_text(encoding="utf-8"))
        for row in rows:
            matches = [r for r in licensed["stores"] if re.sub(r"\D", "", r["comTel"]) == row["phone"]]
            if len(matches) == 1:
                row["government_license_match"] = {
                    "official_id": matches[0]["comKey"],
                    "address": matches[0]["comAdsTw"],
                    "source_url": licensed["source"],
                }
    write("macau-directory-cross-check.json", {
        "source_url": DIRECTORY,
        "source_type": "public_business_directory",
        "fetched_at": now,
        "response_sha256": hashlib.sha256(response).hexdigest(),
        "row_count": len(rows),
        "coverage_complete": False,
        "government_license_phone_matches": sum("government_license_match" in row for row in rows),
        "scope_note": "完整读取本页分店表，不保证澳门当前营业品牌门店全量。地址冲突优先采用政府新资料；原来源仍保留。",
        "rows": rows,
    })
    raw_event = get(EVENT)
    event = json.loads(raw_event)
    event_rows = [r for r in event if "麥當勞" in json.dumps(r, ensure_ascii=False) or "McDonald" in json.dumps(r)]
    write("macau-government-event-stores.json", {
        "source_url": EVENT,
        "source_page": "https://lum.macaotourism.gov.mo/",
        "fetched_at": now,
        "sha256": hashlib.sha256(raw_event).hexdigest(),
        "full_source_rows": len(event),
        "coverage_complete": False,
        "scope_note": "旅游局2025光影节参与商户公开资料，不保证全部或当前营业门店。",
        "rows": event_rows,
    })
    print(json.dumps({"directory_rows": len(rows), "event_rows": len(event_rows)}))


if __name__ == "__main__":
    main()
