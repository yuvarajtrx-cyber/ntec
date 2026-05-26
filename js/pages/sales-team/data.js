import { sumBy } from "../../format.js";
import { ST, UNASSIGNED } from "./state.js";

export function isDomestic(cat) { return /^domestic/i.test(cat || ""); }
export function isExport(cat)   { return /^export/i.test(cat || ""); }
export function isFG(cat)       { return /finished goods/i.test(cat || ""); }
export function isRM(cat)       { return /raw material/i.test(cat || ""); }
export function isOther(cat)    { return !isDomestic(cat) && !isExport(cat); }

export function rowGst(r) {
  return (+r.sgst_9pct || 0) + (+r.cgst_9pct || 0) + (+r.igst_18pct || 0);
}

export function applyFilters(rows) {
  const { saleGroup, material, month, dateFrom, dateTo, q } = ST.filters;
  const needle = q.trim().toLowerCase();
  return rows.filter(r => {
    if (saleGroup === "domestic" && !isDomestic(r.category)) return false;
    if (saleGroup === "export"   && !isExport(r.category))   return false;
    if (saleGroup === "other"    && !isOther(r.category))    return false;
    if (material === "fg" && !isFG(r.category)) return false;
    if (material === "rm" && !isRM(r.category)) return false;
    if (month && (r.voucher_date || "").slice(0, 7) !== month) return false;
    if (dateFrom && (r.voucher_date || "") < dateFrom) return false;
    if (dateTo   && (r.voucher_date || "") > dateTo)   return false;
    if (needle) {
      const hay = `${r.particulars || ""} ${r.sales_person || ""} ${r.voucher_no || ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export function aggregate(rows) {
  return {
    gross:    sumBy(rows, "gross_total"),
    taxable:  sumBy(rows, "taxable_value"),
    gst:      rows.reduce((a, r) => a + rowGst(r), 0),
    qty:      sumBy(rows, "quantity"),
    invoices: rows.length,
  };
}

export function topGrossGroup(rows, keyFn) {
  const groups = new Map();
  rows.forEach(r => {
    const key = keyFn(r);
    if (!key) return;
    groups.set(key, (groups.get(key) || 0) + (+r.gross_total || 0));
  });
  return [...groups.entries()]
    .map(([key, gross]) => ({ key, gross }))
    .sort((a, b) => b.gross - a.gross)[0] || { key: "—", gross: 0 };
}

export function latestDate(rows) {
  const dates = rows.map(r => r.voucher_date).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : "—";
}

export function shortName(value, max = 28) {
  const s = String(value || "—");
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

export function grossGroups(rows, keyFn) {
  const groups = new Map();
  rows.forEach(r => {
    const key = keyFn(r);
    if (!key) return;
    const current = groups.get(key) || { key, gross: 0, taxable: 0, invoices: 0 };
    current.gross += +r.gross_total || 0;
    current.taxable += +r.taxable_value || 0;
    current.invoices += 1;
    groups.set(key, current);
  });
  return [...groups.values()].sort((a, b) => b.gross - a.gross);
}

export function monthGroups(rows) {
  const groups = new Map();
  rows.forEach(r => {
    const key = (r.voucher_date || "").slice(0, 7);
    if (!key) return;
    const current = groups.get(key) || { key, gross: 0, invoices: 0 };
    current.gross += +r.gross_total || 0;
    current.invoices += 1;
    groups.set(key, current);
  });
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function buildPersonGroups(rows) {
  const byPerson = new Map();
  rows.forEach(r => {
    const person = r.sales_person || UNASSIGNED;
    const bucket = byPerson.get(person) || {
      person, rows: [], customers: new Set(),
    };
    bucket.rows.push(r);
    if (r.particulars) bucket.customers.add(r.particulars);
    byPerson.set(person, bucket);
  });

  return [...byPerson.values()].map(g => ({
    person: g.person,
    customers: g.customers.size,
    rows: g.rows,
    ...aggregate(g.rows),
  })).map(g => {
    const topCustomer = topGrossGroup(g.rows, r => r.particulars || "(no name)");
    const topCategory = topGrossGroup(g.rows, r => r.category || "Other");
    const topShare = g.gross ? (topCustomer.gross / g.gross) * 100 : 0;
    return {
      ...g,
      topCustomer: topCustomer.key,
      topCustomerGross: topCustomer.gross,
      topCategory: topCategory.key,
      topCategoryShare: g.gross ? (topCategory.gross / g.gross) * 100 : 0,
      avgInvoice: g.invoices ? g.gross / g.invoices : 0,
      lastSale: latestDate(g.rows),
      concentration: topShare,
    };
  }).sort((a, b) => b.gross - a.gross);
}

export function invoiceBands(rows) {
  const bands = [
    { label: "< 50k", min: 0, max: 50000, count: 0, gross: 0 },
    { label: "50k-1L", min: 50000, max: 100000, count: 0, gross: 0 },
    { label: "1L-5L", min: 100000, max: 500000, count: 0, gross: 0 },
    { label: "5L-10L", min: 500000, max: 1000000, count: 0, gross: 0 },
    { label: "> 10L", min: 1000000, max: Infinity, count: 0, gross: 0 },
  ];
  rows.forEach(r => {
    const gross = +r.gross_total || 0;
    const band = bands.find(b => gross >= b.min && gross < b.max);
    if (!band) return;
    band.count += 1;
    band.gross += gross;
  });
  return bands;
}
