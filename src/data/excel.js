/** تصدير واستيراد ملفات Excel (يُحمَّل SheetJS عند الحاجة فقط). */
let XLSXPromise = null;

export async function xlsx() {
  if (!XLSXPromise) {
    XLSXPromise = import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
  }
  return XLSXPromise;
}

/** يصدّر مصفوفة كائنات إلى ملف .xlsx */
export async function exportRows(rows, fileName, sheetName = "بيانات") {
  const XLSX = await xlsx();
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 28));
  XLSX.writeFile(wb, `${fileName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/** يصدّر عدة أوراق في ملف واحد: [{name, rows}] */
export async function exportSheets(sheets, fileName) {
  const XLSX = await xlsx();
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name.slice(0, 28));
  }
  XLSX.writeFile(wb, `${fileName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/** يقرأ ملفًا مرفوعًا ويرجع { sheetName: rows[] } */
export async function readWorkbook(file) {
  const XLSX = await xlsx();
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const out = {};
  for (const name of wb.SheetNames) {
    out[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" });
  }
  return out;
}
