/**
 * كل الوصول لقاعدة البيانات يمر من هنا.
 * أي تغيير في مصدر البيانات مستقبلًا يتم في هذا الملف وحده.
 */
import { db, run } from "./client.js";
import { APP } from "../config.js";

/* ------------------------- الأصناف ------------------------- */
/**
 * تنظيف نصّ البحث قبل وضعه داخل مرشّح PostgREST.
 *
 * `.or("col.ilike.%نص%,col2.ilike.%نص%")` تُبنى بالنصّ، فالفاصلة والنقطة
 * والقوس في مدخلات المستخدم أحرفٌ لها معنى في صيغة المرشّح لا حروف بحث.
 * بحثٌ مثل `x,role.eq.admin` يُضيف شرطًا لم نكتبه نحن.
 *
 * RLS تمنع قراءة ما لا يُسمح به مهما كان الشرط، فهذا ليس تسريبًا —
 * لكنه يسمح بتوسيع النتائج داخل الجدول نفسه وبإسقاط الاستعلام بخطأ.
 * نزيل الأحرف ذات المعنى ونُبقي البحث بحثًا.
 */
function safeSearch(text) {
  return String(text || "")
    .replace(/[,()*%\\'"`:.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

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
      .select("*", { count: "planned" })
      .order("txn_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(page * size, page * size + size - 1);

    if (type)    q = q.eq("type", type);
    if (itemId)  q = q.eq("item_id", itemId);
    if (project) q = q.eq("project", project);
    if (from)    q = q.gte("txn_date", from);
    if (to)      q = q.lte("txn_date", to);
    const term = safeSearch(search);
    if (term) {
      q = q.or(`voucher_no.ilike.%${term}%,item_name.ilike.%${term}%,party.ilike.%${term}%`);
    }

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
/* ------------------------- المحاسبة ------------------------- */
export const accounting = {
  valuation(from, to)      { return run(db().rpc("valuation_report", { p_from: from, p_to: to })); },
  projectCost(from, to)    { return run(db().rpc("project_cost", { p_from: from, p_to: to })); },
  projectDetail(project, from, to) {
    return run(db().rpc("project_cost_detail", { p_project: project, p_from: from, p_to: to }));
  },
  purchases(from, to)      { return run(db().rpc("purchase_vouchers", { p_from: from, p_to: to })); },
  review(payload) {
    return run(db().rpc("set_voucher_review", {
      p_voucher: payload.voucher_no, p_invoice_no: payload.invoice_no || "",
      p_amount: payload.invoice_amount, p_status: payload.status, p_notes: payload.notes || "",
    }));
  },
  priceReview(gap = 25)    { return run(db().rpc("price_review", { p_gap: gap })); },
  recalcCost()             { return run(db().rpc("recalc_avg_cost")); },
};

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
  list() {
    return run(db().from("profiles")
      .select("id,username,full_name,role,is_active,last_seen,can_receive,can_issue")
      .order("full_name"));
  },
  updateRole(id, role) { return run(db().from("profiles").update({ role }).eq("id", id).select().single()); },
  setActive(id, is_active) { return run(db().from("profiles").update({ is_active }).eq("id", id).select().single()); },
  /** صلاحية الوارد/الصرف لمستخدم واحد — patch = { can_receive } أو { can_issue } */
  setVoucherFlag(id, patch) { return run(db().from("profiles").update(patch).eq("id", id).select().single()); },
};

/* ------------------------- الأدوار والصلاحيات ------------------------- */
export const rbac = {
  /** صلاحيات المستخدم الحالي — تُحمَّل عند الدخول. */
  myPermissions() { return run(db().rpc("my_permissions")); },

  roles()       { return run(db().from("roles").select("*").order("sort").order("label")); },
  permissions() { return run(db().from("permissions").select("*").order("sort")); },
  map()         { return run(db().from("role_permissions").select("*")); },

  /** منح صلاحية لدور. */
  grant(roleCode, permissionCode) {
    return run(db().from("role_permissions")
      .insert({ role_code: roleCode, permission_code: permissionCode }).select());
  },

  /** سحب صلاحية من دور. */
  revoke(roleCode, permissionCode) {
    return run(db().from("role_permissions").delete()
      .eq("role_code", roleCode).eq("permission_code", permissionCode));
  },

  createRole({ code, label }) {
    return run(db().from("roles").insert({ code, label, is_system: false, sort: 100 })
      .select().single());
  },

  renameRole(code, label) {
    return run(db().from("roles").update({ label }).eq("code", code).select().single());
  },

  removeRole(code) { return run(db().from("roles").delete().eq("code", code)); },

  /** عدد المستخدمين في كل دور — لمنع حذف دور مشغول ولعرضه في الشاشة. */
  async roleUsage() {
    const rows = await run(db().from("profiles").select("role"));
    const count = {};
    for (const r of rows) count[r.role] = (count[r.role] || 0) + 1;
    return count;
  },
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



/* ------------------------- سجل التدقيق ------------------------- */
export const audit = {
  /** سجل التعديلات — من فعل ماذا ومتى. الترشيح والترقيم على الخادم. */
  async list({ action = "", entity = "", actor = "", from = "", to = "",
               search = "", page = 0, size = 100 } = {}) {
    let q = db().from("audit_log")
      .select("*", { count: "planned" })
      .order("at", { ascending: false })
      .range(page * size, page * size + size - 1);

    if (action) q = q.eq("action", action);
    if (entity) q = q.eq("entity", entity);
    if (actor)  q = q.eq("actor", actor);
    if (from)   q = q.gte("at", `${from}T00:00:00`);
    if (to)     q = q.lte("at", `${to}T23:59:59`);
    const term = safeSearch(search);
    if (term) q = q.or(`entity_id.ilike.%${term}%,actor_name.ilike.%${term}%`);

    const { data, error, count } = await q;
    if (error) throw error;
    return { rows: data || [], count: count || 0 };
  },

  /** سجل الدخول — ناجح وفاشل. القراءة للمدير فقط (تفرضها سياسة RLS). */
  async authEvents({ event = "", username = "", from = "", to = "",
                     page = 0, size = 100 } = {}) {
    let q = db().from("auth_events")
      .select("*", { count: "planned" })
      .order("created_at", { ascending: false })
      .range(page * size, page * size + size - 1);

    if (event)    q = q.eq("event", event);
    if (username) q = q.ilike("username", `%${username}%`);
    if (from)     q = q.gte("created_at", `${from}T00:00:00`);
    if (to)       q = q.lte("created_at", `${to}T23:59:59`);

    const { data, error, count } = await q;
    if (error) throw error;
    return { rows: data || [], count: count || 0 };
  },

  /** الحسابات المقفولة حاليًا بسبب محاولات فاشلة متكررة. */
  locked() {
    return run(db().from("profiles")
      .select("id,username,full_name,failed_attempts,locked_until")
      .not("locked_until", "is", null)
      .gt("locked_until", new Date().toISOString()));
  },

  /** فكّ القفل يدويًا — المدير فقط (تفرضه سياسة الكتابة على profiles). */
  unlock(id) {
    return run(db().from("profiles")
      .update({ failed_attempts: 0, locked_until: null })
      .eq("id", id).select().single());
  },
};
