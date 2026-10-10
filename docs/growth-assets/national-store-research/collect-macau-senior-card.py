"""Extract McDonald's rows from a dated government public service-point PDF."""
import hashlib
import io
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent
SOURCE = "https://www.gov.mo/zh-hant/wp-content/uploads/sites/4/2025/03/2025%E5%B9%B4%E7%A4%BE%E5%8D%80%E6%B6%88%E8%B2%BB%E5%A4%A7%E5%A5%AC%E8%B3%9E_%E9%95%B7%E8%80%85%E5%8D%A1%E6%B6%88%E8%B2%BB%E7%AB%8B%E6%B8%9B%E5%84%AA%E6%83%A0_%E6%8B%8D%E5%8D%A1%E6%9C%8D%E5%8B%99%E9%BB%9E.pdf"


def main():
    with urllib.request.urlopen(urllib.request.Request(SOURCE, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as response:
        body = response.read()
    rows, all_numbers = [], []
    with pdfplumber.open(io.BytesIO(body)) as pdf:
        first_text = pdf.pages[0].extract_text()
        date = re.search(r"更新日期[：:]\s*(\d{4}/\d{2}/\d{2})", first_text)[1]
        for page_no, page in enumerate(pdf.pages, 1):
            tables = page.extract_tables()
            assert len(tables) == 1 and tables[0][0] == ["序", "地區", "服務點名稱", "地址", "服務時間"]
            for row in tables[0][1:]:
                assert len(row) == 5 and row[0].isdigit()
                number = int(row[0])
                all_numbers.append(number)
                if "麥當勞" not in row[2]:
                    continue
                assert row[3]
                rows.append({
                    "name": row[2].replace("\n", ""), "address": row[3].replace("\n", ""),
                    "address_lines_as_published": row[3], "area": row[1],
                    "historical_service_hours_as_published": row[4].replace("\n", "；"),
                    "source_row": number, "source_pdf_page_one_based": page_no,
                    "source_url": SOURCE, "source_type": "government_dated_event_service_point_list",
                    "published_updated_date": date, "physical_current_operation_verified": False,
                })
        page_count = len(pdf.pages)
    assert all_numbers == list(range(1, max(all_numbers) + 1)), "Incomplete or repeated PDF table rows"
    assert len({r["source_row"] for r in rows}) == len(rows)
    output = {
        "source_url": SOURCE, "source_type": "government_dated_event_service_point_list",
        "fetched_at": datetime.now(timezone.utc).isoformat(), "published_updated_date": date,
        "response_sha256": hashlib.sha256(body).hexdigest(), "response_size_bytes": len(body),
        "pdf_page_count": page_count, "full_pdf_table_rows_checked": len(all_numbers),
        "row_count": len(rows), "brand_entire_region_coverage_verified": False, "added_store_count": 0,
        "scope_note": "政府2025活动服务点资料，逐页表格结构和序号完整校验后仅保存麦当劳行。品牌具名地址可用于身份/历史地址交叉核对，不把旧服务时间当今天营业时间。无电话/门店编号，行号只定位原文。寰宇230号与现目录158号、白鸽巢地下与IAM地牢等差异继续核实，不直接新增/覆盖。",
        "rows": rows,
    }
    (ROOT / "macau-government-senior-card-snapshot.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"brand_rows": len(rows), "all_table_rows_checked": len(all_numbers), "pages": page_count, "published_date": date}, ensure_ascii=False))


if __name__ == "__main__":
    main()
