/** تنبيهات ونوافذ تأكيد موحّدة. */
import { byId, el, esc } from "./dom.js";

export function toast(message, kind = "ok", ms = 3200) {
  const box = byId("toasts");
  const node = el("div", { class: `toast ${kind === "ok" ? "" : kind}`, text: message });
  box.append(node);
  setTimeout(() => { node.style.opacity = "0"; setTimeout(() => node.remove(), 200); }, ms);
}

export const toastError = (m) => toast(m, "error", 5000);
export const toastWarn  = (m) => toast(m, "warn", 4200);

/** نافذة تأكيد تُرجع Promise<boolean> — بديل confirm() مع دعم RTL. */
export function confirmDialog({ title, message, confirmText = "تأكيد", danger = false }) {
  return new Promise((resolve) => {
    const backdrop = el("div", { class: "modal-backdrop open" });
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" style="width:min(460px,100%)">
        <header><h2>${esc(title)}</h2></header>
        <div class="body">${esc(message).replace(/\n/g, "<br>")}</div>
        <footer>
          <button class="btn ${danger ? "danger" : ""}" data-ok>${esc(confirmText)}</button>
          <button class="btn ghost" data-cancel>إلغاء</button>
        </footer>
      </div>`;
    const close = (result) => { backdrop.remove(); document.body.classList.remove("is-locked"); resolve(result); };
    backdrop.querySelector("[data-ok]").onclick = () => close(true);
    backdrop.querySelector("[data-cancel]").onclick = () => close(false);
    backdrop.onclick = (e) => { if (e.target === backdrop) close(false); };
    document.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape") { document.removeEventListener("keydown", onKey); close(false); }
    });
    document.body.append(backdrop);
    document.body.classList.add("is-locked");
    backdrop.querySelector("[data-ok]").focus();
  });
}

/** نافذة عامة تحتوي محتوى مخصّص. تُرجع دالة الإغلاق. */
export function openModal({ title, bodyHtml, actions = [] }) {
  const backdrop = el("div", { class: "modal-backdrop open" });
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <header><h2>${esc(title)}</h2><span class="spacer"></span>
        <button class="btn ghost small" data-close>إغلاق</button></header>
      <div class="body">${bodyHtml}</div>
      ${actions.length ? `<footer>${actions.map((a, i) =>
        `<button class="btn ${a.kind || ""}" data-action="${i}">${esc(a.label)}</button>`).join("")}</footer>` : ""}
    </div>`;
  const close = () => { backdrop.remove(); document.body.classList.remove("is-locked"); };
  backdrop.querySelector("[data-close]").onclick = close;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  actions.forEach((a, i) => {
    backdrop.querySelector(`[data-action="${i}"]`).onclick = () => a.onClick(backdrop, close);
  });
  document.body.append(backdrop);
  document.body.classList.add("is-locked");
  return { root: backdrop, close };
}

/** مؤشر حالة الاتصال أعلى الشاشة. */
export function setConnection(state, label) {
  const node = byId("connBadge");
  if (!node) return;
  node.dataset.state = state;
  node.querySelector(".conn-text").textContent = label;
}

/** يمنع الضغط المزدوج على زر أثناء تنفيذ عملية. */
export async function withBusy(button, fn, busyText = "جارٍ التنفيذ...") {
  if (!button) return fn();
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  try { return await fn(); }
  finally { button.disabled = false; button.textContent = original; }
}
