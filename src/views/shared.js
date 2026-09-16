/** أدوات مشتركة بين الشاشات. */
import { reports } from "../data/repo.js";
import { set } from "../core/store.js";

/** يحدّث أرقام لوحة القيادة بعد أي عملية تغيّر الأرصدة. */
export async function refreshSummary() {
  try {
    set({ summary: await reports.summary() });
  } catch { /* لا توقف العملية بسبب فشل التحديث */ }
}

/** أول يوم في الشهر الحالي — قيمة افتراضية لمرشّحات التقارير. */
export function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
