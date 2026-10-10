"""Materialize a reviewed address crosswalk; never use row numbers as store IDs."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# Explicit reviewed relationships. No automatic building-name fuzzy joins.
# Only complete address agreement or a separately sourced same-phone event address
# is eligible for attaching the IAM source without further review.
RELATIONS = [
    (0, "28781185", "complete_address_agreement", "127-153號、濠景第三座、地下A座一致；目录多地区前缀。"),
    (1, "28757282", "event_phone_and_address", "活动页电话唯一对应，26/32/36号、利景阁、地下S/T/U与许可一致。"),
    (2, "28976018", "address_candidate", "同鵝眉街地下A座；目录3号在许可1-3号内，门牌范围未完全相同。"),
    (3, "28830221", "address_candidate", "同宝龙花园地下F，南京街与大连街表述不同，街道门牌需核对。"),
    (4, "28436055", "address_conflict", "同信达广场第二座，但目录104室与许可地下/一楼多铺号差异未确认。"),
    (5, "28238758", "address_conflict", "目录新城市商业中心第二座李宝椿街；许可新城市花园第二十一座巴波沙大马路，不能默认同店。"),
    (6, "28253182", "address_candidate", "同林茂海边大马路泉福翡翠；目录没列B/F铺，需补铺位。"),
    (7, "28525708", "address_candidate", "同高士德大马路；目录46-48号、许可46号地下及一楼B座，范围/单元需确认。"),
    (8, "28950355", "address_conflict", "同白鸽巢前地；目录丽豪花园地下，许可6/7/8号地牢，未确认楼层。"),
    (9, "28339221", "address_candidate", "同水坑尾135-147范围，许可细分三组门牌/B/C/D铺和阁楼。"),
    (10, "28232208", "event_phone_and_address", "活动页电话唯一对应；北京街230-246金融中心地下J及1楼H/I/J/K完整一致。"),
    (11, "28827473", "address_candidate", "同地堡街泉福伟鸿阁，目录地下A，许可A/B/C；不能删单元后精确匹配。"),
    (12, "28521996", "address_candidate", "同慕拉士龙园地下A；目录124-130，许可124-126，门牌范围差异。"),
    (13, "28473327", "address_candidate", "同侨光工业大厦，目录马场海边路地下L，许可永乐/永华街地下K/L/M/N，需确认角铺。"),
    (14, "28840788", "complete_address_agreement", "大学大马路S1地面层G016/G017/G018完整一致；商舖/舖为同单元文本。"),
    (15, "28768198", "address_candidate", "同黑沙环中街158号寰宇天下地下AB，许可另分商铺B，须保留。"),
    (16, "28316002", "complete_address_agreement", "柯维纳212乐骏盈轩第一座地下AY一致；许可括号注明A区。"),
    (17, "28300160", "event_phone_and_address", "活动页电话唯一对应；布鲁塞尔28/32/36/42、兴海/建富、地下Q/R/S及T阁楼一致。许可另称各座地下及阁楼，原文保留。"),
    (18, "28357861", "complete_address_agreement", "贾伯乐150-152号栢威地下A一致；目录名称柏威、地址栢威，许可补第一/二座。"),
    (19, "28855105", "address_candidate", "同花城利盈地下M；目录487号，许可481-487，门牌范围不同。"),
    (20, "28757123", "event_phone_and_address", "活动页电话唯一对应，孙逸仙大马路科学馆地下/地面层一致。"),
    (21, "28703031", "event_phone_and_address", "活动页电话唯一对应，外港码头3楼3006一致。"),
    (22, "28939226", "address_candidate", "同河边新街凯泉湾F/G/H；许可未列门牌，目录94-120，完整地址不足。"),
    (23, "28261802", "address_conflict", "同信和广场；目录沙梨头199-209、地下AC/AD，许可182/188/209及海湾南街、地下及1楼AC/AD/AE/AF，范围不同。"),
    (24, "28861550", "address_candidate", "同机场客运大楼阁楼C铺；许可补地段，场地官网位置编码另为01-02-0009，不能直接合并单元。"),
    (25, "28761738", "address_candidate", "同御景湾第一座地下E，但目录黑沙环新街，许可马交石204-212，街道表述未确认。"),
    (26, "28716521", "address_conflict", "同湖景豪庭，但目录776号、许可766/760/744-A，另有地下/阁楼B/C/D差异，不可覆盖旧址。"),
    (27, "28503357", "address_candidate", "同业兴二街第五座地下A；目录77号，许可65-77，范围有差异。"),
    (28, None, "new_branch_supported", "现38电话均无28373930。活动页利新28373930、高美士124-126/利新地下A与许可一致；许可额外阁楼A需分别存。"),
    (29, "28920160", "address_candidate", "同信达堡/板樟堂，目录19号地下，许可13-19A及德香里6号、多单元/1楼，不删楼层硬匹配。"),
    (30, "28920004", "complete_address_agreement", "提督马路162-166贾梅士地下B-G及1楼I-J一致；许可补同项目两座名称。"),
]


def main():
    paths = {k: ROOT / v for k, v in {
        "iam": "macau-iam-license-snapshot.json", "directory": "macau-directory-cross-check.json",
        "event": "macau-event-merchant-snapshot.json", "tourism": "macau-tourism-license-partial.json",
    }.items()}
    sources = {k: json.loads(p.read_text(encoding="utf-8")) for k, p in paths.items()}
    iam = {row["source_row"]: row for row in sources["iam"]["rows"]}
    directory = {row["phone"]: row for row in sources["directory"]["rows"]}
    events = {row["phone"]: row for row in sources["event"]["rows"]}
    tourism = {row["comTel"]: row for row in sources["tourism"]["stores"]}
    assert len(RELATIONS) == len(iam) == 31
    rows = []
    for idx, phone, status, note in RELATIONS:
        old = directory.get(phone)
        event = events.get(phone or "28373930")
        if status == "event_phone_and_address":
            assert event and event["directory_phone_match_unique"]
        row = {
            "iam_source_row": idx, "iam_name": iam[idx]["name"], "license_address": iam[idx]["address"],
            "license_source_url": iam[idx]["source_url"], "relationship": status,
            "directory_name": old["name"] if old else None, "directory_phone": phone,
            "directory_address": old["address"] if old else None,
            "directory_source_url": old["source_url"] if old else None,
            "address_review_note": note,
            "eligible_to_attach_iam_source": status in {"complete_address_agreement", "event_phone_and_address"},
            "physical_current_operation_verified": False,
        }
        if event:
            row["event_evidence"] = event
        rows.append(row)
    represented = {phone for _, phone, _, _ in RELATIONS if phone}
    unmatched = []
    for phone, old in directory.items():
        if phone in represented:
            continue
        extra = tourism.get(phone)
        unmatched.append({**old, "tourism_license_id": extra["comKey"] if extra else None,
                          "note": "有独立旅游局许可；不在本次IAM同名查询内，不新增重复条目。" if extra else "未在本次IAM同名查询及旅游局6条内对应，继续查场地/登记来源；不删除既有店。"})
    counts = {status: sum(r["relationship"] == status for r in rows) for status in sorted({r["relationship"] for r in rows})}
    output = {
        "input_sha256": {k: hashlib.sha256(p.read_bytes()).hexdigest() for k, p in paths.items()},
        "iam_rows": len(iam), "directory_rows": len(directory), "relationships": counts,
        "eligible_existing_address_links": sum(r["eligible_to_attach_iam_source"] for r in rows),
        "existing_directory_without_iam_candidate": len(unmatched),
        "new_branch_supported_count": 1, "brand_entire_region_coverage_verified": False,
        "scope_note": "逐行人工比对交叉表，候选不等于唯一确认。IAM没有电话/许可编号；行号只作本次证据定位，不能生成门店ID。保留街道、门牌、楼层、铺位差异；现有目录中未经匹配的记录继续核对。",
        "rows": rows, "directory_without_iam_candidate": unmatched,
    }
    (ROOT / "macau-iam-directory-crosswalk.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = ["# 澳门市政署31条许可与38条目录的逐行交叉表", "", output["scope_note"], "",
             f"可直接附加许可来源的完整地址/独立电话证据对应：{output['eligible_existing_address_links']}条；新增利新店证据1条。其余候选继续核对，8条旧目录未在本次IAM查询中对应。", "",
             "| IAM行（仅证据位置） | 目录分店/电话 | 许可完整地址 | 目录完整地址 | 结论及差异 |",
             "| --- | --- | --- | --- | --- |"]
    for r in rows:
        lines.append(f"| {r['iam_source_row']} | {r['directory_name'] or '新增候选：利新'} / {r['directory_phone'] or '28373930'} | {r['license_address']} | {r['directory_address'] or r['event_evidence']['address']} | {r['relationship']}：{r['address_review_note']} |")
    lines.extend(["", "## 未在IAM同名查询内对应的8条既有目录", ""])
    for r in unmatched:
        lines.append(f"- {r['name']} / {r['phone']} / {r['address']}：{r['note']}")
    (ROOT / "macau-iam-directory-crosswalk.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"relationships": counts, "eligible_links": output["eligible_existing_address_links"], "unmatched_directory": len(unmatched)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
