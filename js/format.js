const fmtINR  = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const fmtINR0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const fmtNum  = new Intl.NumberFormat("en-IN");

export function money(n, decimals = false) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return (decimals ? fmtINR : fmtINR0).format(n);
}

export function num(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return fmtNum.format(n);
}

export function pct(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return `${Number(n).toFixed(1)}%`;
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function monthLabel(value) {
  const d = new Date(`${value}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, { month: "short", year: "numeric" });
}

export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseLocalDate(value) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addDays(value, days) {
  const d = typeof value === "string" ? parseLocalDate(value) : new Date(value);
  if (!d || Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export function daysBetween(a, b) {
  const da = parseLocalDate(a);
  const db = parseLocalDate(b);
  if (!da || !db) return 0;
  return Math.round((db - da) / 86400000);
}

export function addMonths(monthValue, n) {
  const d = new Date(`${monthValue}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return monthValue;
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthDiff(startMonth, endMonth) {
  const s = new Date(`${startMonth}-01T00:00:00`);
  const e = new Date(`${endMonth}-01T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
  return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
}

export function sumBy(rows, field) {
  return rows.reduce((a, r) => a + (Number(r[field]) || 0), 0);
}

export function groupRows(rows, keyFn, valueFn = r => Number(r.gross_total) || 0) {
  const groups = new Map();
  rows.forEach(r => {
    const key = keyFn(r);
    if (!key) return;
    const current = groups.get(key) || { key, value: 0, count: 0 };
    current.value += valueFn(r);
    current.count += 1;
    groups.set(key, current);
  });
  return [...groups.values()].sort((a, b) => b.value - a.value);
}

export function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

export function populateFilter(id, values) {
  const sel = document.getElementById(id);
  values.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
}
