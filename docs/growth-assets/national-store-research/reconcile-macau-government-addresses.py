"""Link complete dated government addresses; retain every number, floor and unit."""
import hashlib
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def address_key(text):
    text = unicodedata.normalize("NFKC", text).replace("–", "-").replace("－", "-")
    text = re.sub(r"(?<=\d)[,，、](?=\d)", "|", text)
    text = re.sub(r"[\s,，、()（）]", "", text)
    return re.sub(r"^澳門", "", text)


def main():
    paths = {
        "government": ROOT / "macau-government-senior-card-snapshot.json",
        "directory": ROOT / "macau-directory-cross-check.json",
        "iam": ROOT / "macau-iam-license-snapshot.json",
    }
    data = {key: json.loads(path.read_text(encoding="utf-8")) for key, path in paths.items()}
    rows = []
    for source in data["government"]["rows"]:
        key = address_key(source["address"])
        directory = [row for row in data["directory"]["rows"] if address_key(row["address"]) == key]
        reverse = [row for row in data["government"]["rows"] if address_key(row["address"]) == key]
        iam = [row for row in data["iam"]["rows"] if address_key(row["address"]) == key]
        unique = len(directory) == len(reverse) == 1
        rows.append({
            "government_evidence": source,
            "directory_candidates": directory,
            "iam_candidates": iam,
            "directory_full_address_unique": unique,
            "directory_phone": directory[0]["phone"] if unique else None,
            "eligible_to_attach_dated_government_source": unique,
            "eligible_to_attach_new_iam_source": False,
            "current_operation_verified": False,
            "review_note": "完整地址双向唯一，可附2025政府具名来源；不覆盖现营业时间。" if unique else "未与现目录完整地址唯一对应；保留原始楼层、铺位和门牌继续核对。",
        })
    assert len(rows) == 30
    output = {
        "input_sha256": {key: hashlib.sha256(path.read_bytes()).hexdigest() for key, path in paths.items()},
        "normalization": "NFKC、空白、逗号/顿号/括号、横杠字体及开头澳門前缀；不删除街道、门牌、楼层或铺位。",
        "government_rows": len(rows),
        "unique_existing_directory_addresses": sum(row["directory_full_address_unique"] for row in rows),
        "government_iam_full_address_matches": sum(len(row["iam_candidates"]) == 1 for row in rows),
        "added_store_count": 0,
        "rows": rows,
    }
    (ROOT / "macau-government-address-crosswalk.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: output[key] for key in ("government_rows", "unique_existing_directory_addresses", "government_iam_full_address_matches", "added_store_count")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
