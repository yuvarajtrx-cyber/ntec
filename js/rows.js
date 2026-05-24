import { isoDate } from "./format.js";
import { normalizeProductName } from "./product-utils.js";

export function uniqueSorted(rows, field) {
  return [...new Set(rows.map(r => r[field]).filter(Boolean))].sort();
}

export function uniqueMonths(rows) {
  return [...new Set(rows.map(r => (r.voucher_date || "").slice(0, 7)).filter(Boolean))].sort();
}

export function getReferenceDate(rows) {
  const dates = rows.map(r => r.voucher_date).filter(Boolean).sort();
  if (dates.length) return dates[dates.length - 1];
  return isoDate(new Date());
}

export function uniqueProducts(rows) {
  // Dedupe by lowercase key but return the first-seen normalized display name.
  const byKey = new Map();
  rows.forEach(r => (r.line_items || []).forEach(li => {
    const display = normalizeProductName(li?.particulars);
    if (!display) return;
    const key = display.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, display);
  }));
  return [...byKey.values()].sort();
}
