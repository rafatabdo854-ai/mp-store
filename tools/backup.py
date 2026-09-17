#!/usr/bin/env python3
"""
نسخة احتياطية لقاعدة بيانات المخزن.

يسحب كل جدول من Supabase عبر REST، يحوّله CSV، ويضغط الكل في ملف zip.
يُشغَّل من GitHub Actions يوميًا — راجع .github/workflows/daily-backup.yml

لا يعتمد على أي مكتبة خارجية: مكتبة بايثون القياسية فقط.

المخرجات:
  backup/mp-store-backup-YYYY-MM-DD.zip
  backup/report.txt     ← ملخّص يُستخدم كنص الرسالة
  backup/subject.txt    ← عنوان الرسالة
"""

import csv
import io
import json
import os
import sys
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone

# الجداول بالترتيب الذي يصلح للاستيراد عند الاستعادة (الأب قبل الابن)
TABLES = [
    "profiles",
    "categories",
    "suppliers",
    "projects",
    "items",
    "transactions",
    "stocktakes",
    "stocktake_lines",
    "voucher_review",
    "voucher_counters",
    "settings",
    "audit_log",
    "auth_events",
]

PAGE_SIZE = 1000          # أقصى عدد صفوف يرجّعه PostgREST في الطلب الواحد
CAIRO = timezone(timedelta(hours=3))
OUT_DIR = "backup"


def fetch_all(base_url, key, table):
    """يقرأ كل صفوف الجدول على دفعات باستخدام ترويسة Range."""
    rows = []
    start = 0

    while True:
        url = f"{base_url}/rest/v1/{table}?select=*"
        req = urllib.request.Request(url, method="GET")
        req.add_header("apikey", key)
        req.add_header("Authorization", f"Bearer {key}")
        req.add_header("Range-Unit", "items")
        req.add_header("Range", f"{start}-{start + PAGE_SIZE - 1}")

        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                page = json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            # 416 = تجاوزنا آخر صف، وهذا طبيعي في جدول فارغ
            if err.code == 416:
                break
            detail = err.read().decode("utf-8", "replace")[:200]
            raise RuntimeError(f"HTTP {err.code} — {detail}") from None

        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
        start += PAGE_SIZE

    return rows


def to_csv(rows):
    """يحوّل قائمة صفوف JSON إلى نص CSV بترميز يفتحه Excel عربيًا."""
    if not rows:
        return "\ufeff"

    # نجمع الأعمدة من كل الصفوف، لأن حقول jsonb قد تغيب عن بعضها
    cols = []
    for row in rows:
        for key in row:
            if key not in cols:
                cols.append(key)

    buf = io.StringIO(newline="")
    writer = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore",
                            lineterminator="\r\n")
    writer.writeheader()

    for row in rows:
        flat = {}
        for col in cols:
            value = row.get(col)
            if value is None:
                flat[col] = ""
            elif isinstance(value, (dict, list)):
                flat[col] = json.dumps(value, ensure_ascii=False)
            else:
                flat[col] = value
        writer.writerow(flat)

    return "\ufeff" + buf.getvalue()


def main():
    base_url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or ""

    if not base_url or not key:
        print("SUPABASE_URL أو SUPABASE_SERVICE_KEY غير مضبوط", file=sys.stderr)
        return 1

    stamp = datetime.now(CAIRO).strftime("%Y-%m-%d")
    os.makedirs(OUT_DIR, exist_ok=True)
    zip_path = os.path.join(OUT_DIR, f"mp-store-backup-{stamp}.zip")

    counts = {}
    failures = []

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for table in TABLES:
            try:
                rows = fetch_all(base_url, key, table)
                counts[table] = str(len(rows))
                archive.writestr(f"{table}.csv", to_csv(rows).encode("utf-8"))
                print(f"  {table}: {len(rows)} صف")
            except Exception as err:  # جدول واحد يفشل لا يوقف الباقي
                counts[table] = "—"
                failures.append(f"{table}: {err}")
                print(f"  {table}: فشل — {err}", file=sys.stderr)

    size_kb = round(os.path.getsize(zip_path) / 1024)

    lines = [
        "النسخة الاحتياطية اليومية لقاعدة بيانات المخزن.",
        f"التاريخ: {stamp}",
        f"حجم الملف: {size_kb} كيلوبايت",
        "",
        "عدد الصفوف في كل جدول:",
    ]
    lines += [f"  {t}: {counts.get(t, '—')}" for t in TABLES]

    if failures:
        lines += ["", "⚠️ جداول لم تُصدَّر:"] + [f"  {f}" for f in failures]

    lines += [
        "",
        "للاستعادة: شغّل ملفات sql/ بالترتيب من المستودع،",
        "ثم استورد ملفات CSV من المرفق بنفس ترتيب الجداول أعلاه.",
    ]

    with open(os.path.join(OUT_DIR, "report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    mark = "⚠️ " if failures else ""
    with open(os.path.join(OUT_DIR, "subject.txt"), "w", encoding="utf-8") as f:
        f.write(f"{mark}نسخة احتياطية — مخزن الهنا الكتريك — {stamp}")

    with open(os.path.join(OUT_DIR, "zipname.txt"), "w", encoding="utf-8") as f:
        f.write(zip_path)

    # نجاح جزئي يظل نجاحًا: المهم أن تصل الرسالة ويظهر فيها ما فشل
    return 0


if __name__ == "__main__":
    sys.exit(main())
