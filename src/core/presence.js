// حضور المستخدمين — من يعمل على النظام الآن.
//
// طبقتان لأنهما تجيبان عن سؤالين مختلفين:
//
// 1) Presence عبر Supabase Realtime: قائمة المتصلين الآن، تتحدّث خلال
//    ثانية، ولا تكتب شيئًا في قاعدة البيانات. تختفي وحدها عند إغلاق
//    التبويب أو انقطاع الشبكة، فلا تُظهر أحدًا متصلًا وهو ليس كذلك.
//
// 2) نبضة last_seen كل HEARTBEAT_MS: تبقى بعد الخروج، وتجيب عن
//    "من لم يدخل منذ أسبوعين؟" — وهو ما لا تعرفه Presence أصلًا.
//
// وإن كان Realtime مغلقًا أو تعذّر الاشتراك، نسقط تلقائيًا إلى سؤال
// الخادم عن active_users كل POLL_MS. أبطأ بدقيقة، لكنه يعمل دائمًا —
// فلا تظهر شاشة تقول "لا أحد متصل" بينما الناس تعمل.

import { db, run } from "../data/client.js";
import { get } from "./store.js";
import { APP } from "../config.js";

const HEARTBEAT_MS = 3 * 60 * 1000;   // نبضة الحضور كل 3 دقائق
const POLL_MS      = 60 * 1000;       // سؤال الخادم كل دقيقة عند غياب Realtime
const ONLINE_MINS  = 5;               // من نبض خلالها يُعدّ متصلًا
const SUBSCRIBE_TIMEOUT_MS = 8000;    // مهلة انتظار قناة Realtime
const CHANNEL = "presence-online";

let channel = null;
let beatTimer = null;
let pollTimer = null;
let subscribeTimer = null;
let listeners = new Set();
let online = [];
let mode = "none";   // realtime | polling | none

// من يريد متابعة قائمة المتصلين. يُرجع دالة لإلغاء الاشتراك.
export function onPresence(fn) {
  listeners.add(fn);
  fn(online);
  return () => listeners.delete(fn);
}

export function onlineUsers() { return online; }
export function presenceMode() { return mode; }

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
  clearInterval(beatTimer);
  beatTimer = setInterval(beat, HEARTBEAT_MS);

  // نبضة فورية عند العودة للتبويب: من ترك الجهاز ساعة يظهر متصلًا
  // خلال ثوانٍ من عودته، لا بعد ثلاث دقائق
  document.addEventListener("visibilitychange", onVisible);

  if (!APP.realtime) { startPolling(); return; }
  if (channel) return;

  try {
    channel = db().channel(CHANNEL, { config: { presence: { key: me.id } } });
  } catch (e) {
    startPolling();
    return;
  }

  // إن لم تُفتح القناة خلال المهلة فالأرجح أن Realtime غير مفعّل
  // للمشروع؛ لا ننتظر إلى ما لا نهاية
  subscribeTimer = setTimeout(() => {
    if (mode !== "realtime") startPolling();
  }, SUBSCRIBE_TIMEOUT_MS);

  channel
    .on("presence", { event: "sync" }, collect)
    .on("presence", { event: "join" }, collect)
    .on("presence", { event: "leave" }, collect)
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(subscribeTimer);
        mode = "realtime";
        stopPolling();
        // ما يُبثّ للآخرين: اسم ودور ووقت دخول فقط — لا شيء حسّاس،
        // فأي مشترك في القناة يستطيع قراءته
        await channel.track({
          id: me.id,
          name: me.full_name,
          role: me.role,
          since: new Date().toISOString(),
        });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        if (mode !== "polling") startPolling();
      }
    });
}

export function stopPresence() {
  clearInterval(beatTimer); beatTimer = null;
  clearTimeout(subscribeTimer); subscribeTimer = null;
  stopPolling();
  document.removeEventListener("visibilitychange", onVisible);
  if (channel) {
    try { channel.untrack(); } catch (e) {}
    db().removeChannel(channel);
    channel = null;
  }
  mode = "none";
  online = [];
  publish();
}

function onVisible() {
  if (document.visibilityState !== "visible") return;
  beat();
  if (mode === "polling") poll();
}

// ------------------------- عبر Realtime -------------------------

function collect() {
  if (!channel) return;
  const state = channel.presenceState();

  // المستخدم قد يفتح أكثر من تبويب: نطوي تبويباته في صف واحد ونحتفظ
  // بعددها، فيرى المدير شخصًا واحدًا لا ثلاثة
  const map = new Map();
  for (const key of Object.keys(state)) {
    for (const entry of state[key]) {
      if (!entry || !entry.id) continue;
      const found = map.get(entry.id);
      if (found) {
        found.tabs += 1;
        if (entry.since < found.since) found.since = entry.since;
      } else {
        map.set(entry.id, { id: entry.id, name: entry.name, role: entry.role,
                            since: entry.since, tabs: 1 });
      }
    }
  }

  online = [...map.values()].sort((a, b) => String(a.since).localeCompare(String(b.since)));
  publish();
}

// ------------------------- البديل: سؤال الخادم -------------------------

function startPolling() {
  if (mode === "polling") return;
  mode = "polling";
  poll();
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, POLL_MS);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

async function poll() {
  try {
    const data = await run(db().rpc("active_users", { p_minutes: ONLINE_MINS }));
    if (!Array.isArray(data)) return;

    online = data
      .filter((u) => u.online)
      .map((u) => ({ id: u.id, name: u.full_name, role: u.role,
                     since: u.last_seen, tabs: 1 }));
    publish();
  } catch (e) {
    // الدالة غير موجودة (10_presence.sql لم يُشغَّل) أو الشبكة منقطعة:
    // نترك القائمة كما هي بدل إفراغها وإظهار "لا أحد متصل" خطأً
  }
}

// ------------------------- النبضة -------------------------

// فشلها لا يعني شيئًا للمستخدم، فلا نزعجه برسالة
async function beat() {
  try { await run(db().rpc("touch_last_seen")); } catch (e) {}
}
