"""Match original public FDA addresses to original official recruitment addresses."""
from collections import defaultdict
import json
from pathlib import Path
import re
import unicodedata

BASE = Path(__file__).resolve().parent


def normalize(address):
    result = unicodedata.normalize("NFKC", address).replace("臺", "台")
    result = re.sub(r"\s+", "", result)
    for chinese, digit in zip("一二三四五六七八九", "123456789"):
        result = result.replace(chinese + "段", digit + "段")
    return result


def main():
    recruitment = json.loads((BASE / "taiwan-official-recruitment-combined-snapshot.json").read_text(encoding="utf-8"))
    government = json.loads((BASE / "taiwan-food-restaurant-registration.json").read_text(encoding="utf-8"))
    index = defaultdict(list)
    seen = set()
    for row in recruitment["rows"]:
        key = (row["name"], normalize(row["address"]))
        if key in seen:
            continue
        seen.add(key)
        index[key[1]].append(row)
    matches = []
    for row in government["rows"]:
        candidates = index[normalize(row["業者地址"])]
        if len(candidates) != 1:
            continue
        candidate = candidates[0]
        matches.append({
            "registration_id": row["食品業者登錄字號"],
            "government_address": row["業者地址"],
            "brand_store_name": candidate["name"],
            "recruitment_address": candidate["address"],
            "match_method": "exact address after NFKC, whitespace, 台臺 and numbered road-segment normalization",
            "brand_name_source_url": candidate["source_url"],
        })
    output = {
        "coverage_complete": False,
        "source_url": recruitment["source_url"],
        "recruitment_row_count": len(seen),
        "government_row_count": len(government["rows"]),
        "match_count": len(matches),
        "rows": matches,
    }
    (BASE / "taiwan-recruitment-address-matches.json").write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({"strict_matches": len(matches)}))


if __name__ == "__main__":
    main()
