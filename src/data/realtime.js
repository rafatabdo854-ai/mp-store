/** الاشتراك في التغييرات الحيّة: أي تعديل من أي مستخدم يظهر عند الباقي فورًا. */
import { db } from "./client.js";
import { upsertItem, removeItem } from "../core/store.js";
import { setConnection } from "../core/ui.js";
import { APP } from "../config.js";

let channel = null;
const txnHandlers = new Set();

export function onTxnChange(fn) { txnHandlers.add(fn); return () => txnHandlers.delete(fn); }

export function startRealtime() {
  if (!APP.realtime || channel) return;
  channel = db()
    .channel("store-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "items" }, (payload) => {
      if (payload.eventType === "DELETE") removeItem(payload.old.id);
      else upsertItem(payload.new);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, (payload) => {
      txnHandlers.forEach((fn) => fn(payload));
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setConnection("online", "متصل — التحديثات لحظية");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setConnection("offline", "انقطع التحديث اللحظي");
    });
}

export function stopRealtime() {
  if (channel) { db().removeChannel(channel); channel = null; }
}

/** مراقبة اتصال المتصفح بالإنترنت. */
export function watchNetwork() {
  const update = () => {
    if (navigator.onLine) setConnection("syncing", "جارٍ إعادة الاتصال...");
    else setConnection("offline", "بدون اتصال — العرض من النسخة المحلية");
  };
  window.addEventListener("online", () => { update(); stopRealtime(); startRealtime(); });
  window.addEventListener("offline", update);
  if (!navigator.onLine) update();
}
