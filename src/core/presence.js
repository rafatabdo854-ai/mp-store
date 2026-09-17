// حضور المستخدمين — من يعمل على النظام الآن.
//
// طبقتان لأنهما تجيبان عن سؤالين مختلفين:
//
// 1) Presence عبر Supabase Realtime: قائمة المتصلين الآن، تتحدّث خلال
//    ثانية، ولا تكتب شيئًا في قاعدة البيانات. تختفي وحدها عند إغلاق
//    التبويب أو انقطاع الشبكة، فلا تُظهر أحدًا "متصلًا" وهو ليس كذلك.
//
// 2) نبضة last_seen كل HEARTBEAT_MS: تبقى بعد الخروج، وتجيب عن
//    "من لم يدخل منذ أسبوعين؟" — وهو ما لا تعرفه Presence أصلًا.
//
// الأولى للحظة، الثانية للتاريخ.

import { db } from "../data/client.js";
import { get } from "./store.js";
import { APP } from "../config.js";

const HEARTBEAT_MS = 3 * 60 * 1000;   // نبضة كل 3 دقائق
const CHANNEL = "presence-online";

let channel = null;
let timer = null;
let listeners = new Set();
let online = [];

// من يريد متابعة قائمة المتصلين. يُرجع دالة لإلغاء الاشتراك.
export function onPresence(fn) {
  listeners.add(fn);
  fn(online);
  return () => listeners.delete(fn);
}

export function onlineUsers() {
  return online;
}

function publish() {
  listeners.forEach((fn) => {
    try { fn(online); } catch (e) { console.error(e); }
  });
}

// يُستدعى بعد الدخول.
export function startPresence() {
  const me = get("profile");
  if (!me) return;

  beat();
  clearInterval(timer);
  timer = setInterval(beat, HEARTBEAT_MS);

  // نبضة فورية عند العودة للتبويب: من ترك الجهاز ساعة يظهر متصلًا
  // خلال ثوانٍ من عودته، لا بعد ٣ دقائق
  document.addEventListener("visibilitychange", onVisible);

  if (!APP.realtime || channel) return;

  channel = db().channel(CHANNEL, {
    config: { presence: { key: me.id } },
  });

  channel
    .on("presence", { event: "sync" }, collect)
    .on("presence", { event: "join" }, collect)
    .on("presence", { event: "leave" }, collect)
    .subscribe(async (status) => {
      if (status !== "SUBSCRIBED") return;
      // ما نبثّه للآخرين: اسم ودور ووقت دخول فقط — لا شيء حسّاس،
      // فأي مستخدم مشترك في القناة يستطيع قراءته
      await channel.track({
        id: me.id,
        name: me.full_name,
        role: me.role,
        since: new Date().toISOString(),
      });
    });
}

export function stopPresence() {
  clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVisible);
  if (channel) {
    try { channel.untrack(); } catch (e) {}
    db().removeChannel(channel);
    channel = null;
  }
  online = [];
  publish();
}

function onVisible() {
  if (document.visibilityState === "visible") beat();
}

function collect() {
  if (!channel) return;
  const state = channel.presenceState();

  // كل مستخدم قد يفتح أكثر من تبويب: نطوي تبويباته في صف واحد
  // ونحتفظ بعددها، فالمدير يرى شخصًا واحدًا لا ثلاثة
  const map = new Map();
  for (const key of Object.keys(state)) {
    for (const entry of state[key]) {
      const found = map.get(entry.id);
      if (found) {
        found.tabs += 1;
        if (entry.since < found.since) found.since = entry.since;
      } else {
        map.set(entry.id, { ...entry, tabs: 1 });
      }
    }
  }

  online = [...map.values()].sort((a, b) => a.since.localeCompare(b.since));
  publish();
}

// نبضة صامتة: فشلها لا يعني شيئًا للمستخدم، فلا نزعجه برسالة
async function beat() {
  try { await db().rpc("touch_last_seen"); } catch (e) {}
}
