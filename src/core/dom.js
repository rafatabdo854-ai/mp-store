/** أدوات DOM صغيرة — بديل مختصر لمكتبة كاملة. */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const byId = (id) => document.getElementById(id);

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** يمنع حقن HTML عند بناء الصفوف من نصوص المستخدم. */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** استبدال محتوى جدول دفعة واحدة (أسرع من إضافة صف بصف). */
export function fillTable(tbody, rowsHtml, colspan, emptyText = "لا توجد بيانات") {
  tbody.innerHTML = rowsHtml.length
    ? rowsHtml.join("")
    : `<tr><td colspan="${colspan}" class="empty">${esc(emptyText)}</td></tr>`;
}

/** تأخير التنفيذ حتى يتوقف المستخدم عن الكتابة. */
export function debounce(fn, ms = 220) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** تفويض الأحداث: مستمع واحد للجدول كله بدل مستمع لكل زر. */
export function onClick(root, selector, handler) {
  root.addEventListener("click", (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(target, e);
  });
}
