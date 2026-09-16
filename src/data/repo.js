/**
 * كل الوصول لقاعدة البيانات يمر من هنا.
 * أي تغيير في مصدر البيانات مستقبلًا يتم في هذا الملف وحده.
 */
import { db, run } from "./client.js";
import { APP } from "../config.js";

/* ------------------------- الأصناف ------------------------- */
export const items = {
  async list({ includeArchived = false } = {}) {
    let q = db().from("items").select("*").order("code");
    if (!includeArchived) q = q.eq("is_archived", false);
    return run(q);
  },

  async create(payload) {
    const id  = await run(db().rpc("next_item_id"));
    const code = payload.code?.trim() || await run(db().rpc("next_item_code", { p_category: payload.category }));
    const row = {
      id, code,
      category: payload.category,
      brand: payload.brand || "",
      name: payload.name,
      spec: payload.spec || "",
      unit: payload.unit || "قطعة",
      opening_balance: payload.opening_balance || 0,
      balance: payload.opening_balance || 0,
      threshold: payload.threshold ?? 5,
      base_price: payload.base_price || 0,
      extra_costs: payload.extra_costs || 0,
    };
    return run(db().from("items").insert(row).select().single());
  },

  update(id, patch) {
    return run(db().from("items").update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id).select().single());
  },

  archive(id, value = true) { return this.update(id, { is_archived: value }); },

  remove(id) { return run(db().from("items").delete().eq("id", id)); },

  recalcBalances() { return run(db().rpc("recalc_balances")); },
};

/* ------------------------- الحركات ------------------------- */
export const txns = {
  /** سجل الحركات مع ترشيح وترقيم صفحات على الخادم (لا يُحمَّل كل شيء). */
  async list({ type = "", itemId = "", project = "", from = "", to = "", search = "",
                page = 0, size = APP.logPageSize } = {}) {
    let q = db().from("transactions")
      .select("*", { count: "exact" })
      .order("txn_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(page * size, page * size + size - 1);

    if (type)    q = q.eq("type", type);
    if (itemId)  q = q.eq("item_id", itemId);
    if (project) q = q.eq("project", project);
    if (from)    q = q.gte("txn_date", from);
    if (to)      q = q.lte("txn_date", to);
    if (search)  q = q.or(`voucher_no.ilike.%${search}%,item_name.ilike.%${search}%,party.ilike.%${search}%`);

    const { data, error, count } = await q;
    if (error) throw error;
    return { rows: data || [], count: count || 0 };
  },

  byVoucher(voucherNo) {
    return run(db().from("transactions").select("*").eq("voucher_no", voucherNo).order("created_at"));
  },

  /** قائمة الأذون مجمّعة (للعرض في شاشتي الوارد والصرف). */
  async vouchers(type, limit = 20) {
    const rows = await run(db().from("transactions").select("*")
      .eq("type", type).order("created_at", { ascending: false }).limit(limit * 12));
    const map = new Map();
    for (const t of rows) {
      const v = map.get(t.voucher_no) || {
        voucher_no: t.voucher_no, txn_date: t.txn_date, party: t.party,
        project: t.project, created_by_name: t.created_by_name, lines: 0, qty: 0,
      };
      v.lines += 1; v.qty += t.qty;
      map.set(t.voucher_no, v);
    }
    return Array.from(map.values()).slice(0, limit);
  },

  /** إنشاء إذن كامل في نداء واحد ذرّي على الخادم. */
  createVoucher({ type, date, party, project, notes, lines }) {
    return run(db().rpc("create_voucher", {
      p_type: type, p_date: date, p_party: party || "",
      p_project: project || "", p_notes: notes || "", p_lines: lines,
    }));
  },

  deleteVoucher(voucherNo) {
    return run(db().rpc("delete_voucher", { p_voucher_no: voucherNo }));
  },
};

/* ------------------------- التقارير ------------------------- */
export const reports = {
  summary()                         { return run(db().rpc("dashboard_summary")); },
  /** تحليلات لوحة القيادة الذكية في نداء واحد. */
  insights(days = 30)               { return run(db().rpc("dashboard_insights", { p_days: days })); },
  itemMovement(itemId, from, to)    { return run(db().rpc("item_movement", { p_item_id: itemId, p_from: from, p_to: to })); },
  project(name, from, to)           { return run(db().rpc("project_report", { p_project: name, p_from: from, p_to: to })); },

  async topConsumed(from, to, limit = 20) {
    const rows = await run(db().from("transactions").select("item_id,item_name,qty")
      .eq("type", "out").gte("txn_date", from).lte("txn_date", to));
    const map = new Map();
    for (const r of rows) {
      const cur = map.get(r.item_id) || { item_id: r.item_id, item_name: r.item_name, qty: 0 };
      cur.qty += r.qty; map.set(r.item_id, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty).slice(0, limit);
  },
};

/* ------------------------- الجرد ------------------------- */
export const stocktakes = {
  list()        { return run(db().from("stocktakes").select("*").order("created_at", { ascending: false }).limit(50)); },
  lines(id)     { return run(db().from("stocktake_lines").select("*").eq("stocktake_id", id)); },
  post(payload) {
    return run(db().rpc("post_stocktake", {
      p_title: payload.title, p_date: payload.date, p_notes: payload.notes || "",
      p_lines: payload.lines, p_post: Boolean(payload.post),
    }));
  },
  remove(id)    { return run(db().from("stocktakes").delete().eq("id", id)); },
};

/* ------------------------- القوائم والإعدادات ------------------------- */
export const lists = {
  suppliers()  { return run(db().from("suppliers").select("name").order("name")); },
  projects()   { return run(db().from("projects").select("name,status").order("name")); },
  categories() { return run(db().from("categories").select("name,prefix").order("name")); },
  addSupplier(name) { return run(db().from("suppliers").upsert({ name }).select()); },
  addProject(name)  { return run(db().from("projects").upsert({ name }).select()); },
  addCategory(name, prefix) { return run(db().from("categories").upsert({ name, prefix }).select()); },
};

export const users = {
  list() { return run(db().from("profiles").select("*").order("full_name")); },
  updateRole(id, role) { return run(db().from("profiles").update({ role }).eq("id", id).select().single()); },
  setActive(id, is_active) { return run(db().from("profiles").update({ is_active }).eq("id", id).select().single()); },
};

export const settings = {
  async all() {
    const rows = await run(db().from("settings").select("*"));
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },
  set(key, value) {
    return run(db().from("settings").upsert({ key, value, updated_at: new Date().toISOString() }).select());
  },
};

export const audit = {
  list(limit = 200) {
    return run(db().from("audit_log").select("*").order("at", { ascending: false }).limit(limit));
  },
};
