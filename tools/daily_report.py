#!/usr/bin/env python3
"""
الملخّص اليومي — الأصناف المهدَّدة بالنفاد، إلى تليجرام.

يُشغَّل من GitHub Actions كل صباح. يقرأ dashboard_insights من Supabase
ويرسل ما يحتاج تدخّلًا فقط.

مبدأ واحد يحكم هذا الملف: **لا رسالة بلا سبب.**
تنبيه يومي يصل حتى حين لا جديد يصير خلفية يتجاهلها القارئ، فحين يصل
تنبيه حقيقي لا يراه أحد. لذلك: إن لم يكن هناك صنف نافد ولا مهدَّد،
لا تُرسل رسالة إطلاقًا (إلا يوم الأحد، تأكيدًا أن المهمة حيّة).

لا يعتمد على أي مكتبة خارجية.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

CAIRO = timezone(timedelta(hours=3))
RISK_DAYS = 21          # ما يكفي ثلاثة أسابيع أو أقل يستحق التنبيه
MAX_LINES = 12          # رسالة أطول من ذلك لا تُقرأ


def call_rpc(url, key, name, args):
    req = urllib.request.Request(f"{url}/rest/v1/rpc/{name}", method="POST")
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    req.data = json.dumps(args).encode("utf-8")

    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode("utf-8"))


def send(token, chat_id, text):
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage", method="POST")
    req.add_header("Content-Type", "application/json")
    req.data = json.dumps({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }).encode("utf-8")

    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status == 200
    except urllib.error.HTTPError as err:
        print("Telegram error:", err.read().decode("utf-8", "replace")[:300],
              file=sys.stderr)
        return False


def build(data):
    """يبني نصّ الرسالة، ويعيد None إن لم يكن هناك ما يستحق الإرسال."""
    kpi = data.get("kpi") or {}
    risk = data.get("risk") or []
    reorder = data.get("reorder") or []
    movement = data.get("movement") or {}

    out_of_stock = kpi.get("out_of_stock", 0)
    urgent = [r for r in risk if (r.get("days_cover") or 999) <= RISK_DAYS]

    is_sunday = datetime.now(CAIRO).weekday() == 6
    if not out_of_stock and not urgent and not is_sunday:
        return None

    stamp = datetime.now(CAIRO).strftime("%Y-%m-%d")
    lines = [f"<b>مخزن الهنا الكتريك</b> — {stamp}", ""]

    if out_of_stock:
        lines.append(f"🔴 <b>{out_of_stock}</b> صنف نفد من المخزن")
    if kpi.get("low_stock"):
        lines.append(f"🟡 <b>{kpi['low_stock']}</b> صنف تحت الحد الأدنى")
    if kpi.get("unpriced"):
        lines.append(f"⚪ <b>{kpi['unpriced']}</b> صنف بلا سعر")

    if urgent:
        lines += ["", "<b>على وشك النفاد:</b>"]
        for r in urgent[:MAX_LINES]:
            lines.append(
                f"• {r['label']} — رصيد {r['balance']} {r.get('unit','')}"
                f" · يكفي {r['days_cover']} يوم")
        if len(urgent) > MAX_LINES:
            lines.append(f"  <i>و{len(urgent) - MAX_LINES} صنفًا آخر</i>")

    if reorder:
        total = sum(float(r.get("suggest_value") or 0) for r in reorder)
        lines += ["", f"🛒 اقتراح شراء: <b>{len(reorder)}</b> صنف"
                      f" بتكلفة تقديرية <b>{round(total):,}</b> ج.م"]

    if movement:
        lines += ["", f"حركة آخر ٣٠ يومًا: وارد {movement.get('in_now', 0)}"
                      f" · صرف {movement.get('out_now', 0)}"]

    if not urgent and not out_of_stock:
        lines += ["", "✅ لا يوجد صنف نافد أو مهدَّد اليوم."]

    return "\n".join(lines)


def main():
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or ""
    token = os.environ.get("TELEGRAM_TOKEN") or ""
    chat = os.environ.get("TELEGRAM_CHAT_ID") or ""

    if not all([url, key, token, chat]):
        print("الإعدادات ناقصة", file=sys.stderr)
        return 1

    try:
        data = call_rpc(url, key, "dashboard_insights", {"p_days": 30})
    except Exception as err:
        send(token, chat, f"⚠️ تعذّر تجهيز ملخّص المخزن اليومي.\n{err}")
        return 1

    text = build(data)
    if text is None:
        print("لا جديد يستحق الإرسال اليوم")
        return 0

    return 0 if send(token, chat, text) else 1


if __name__ == "__main__":
    sys.exit(main())
