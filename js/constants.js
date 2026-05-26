import { money, num, sumBy } from "./format.js";
import { locationLabel } from "./location.js";

export const ACCENT = "#4f46e5";
export const CHART_PALETTE = ["#4f46e5", "#059669", "#d97706", "#dc2626", "#0891b2", "#7c3aed", "#64748b", "#db2777", "#16a34a", "#ea580c"];

export const HOME_RANGES = {
  "7d":        { label: "Last 7 days",  bucket: "day",       count: 7  },
  "lastmonth": { label: "Last month",   bucket: "monthDays"            },
  "quarter":   { label: "Last quarter", bucket: "month",     count: 3  },
  "1y":        { label: "Last 1 year",  bucket: "month",     count: 12 },
  "3y":        { label: "Last 3 years", bucket: "year",      count: 3  },
  "5y":        { label: "Last 5 years", bucket: "year",      count: 5  },
};

export const KPI_DEFAULT_SETTINGS = {
  concentration: { targetPct: 80, topCustomers: 25 },
  repeat: { minInvoices: 2 },
  cohort: { months: 6, minInvoices: 1 },
  dormant: { days: 90, limit: 15 },
  cadence: { minInvoices: 3, watchStdDev: 1, highStdDev: 2, limit: 20 },
};

export const ANALYSIS_DIMENSIONS = {
  category: { label: "Sale Type", key: r => r.category || "Unknown" },
  sales_person: { label: "Salesperson", key: r => r.sales_person || "Unassigned" },
  market: { label: "Market", key: r => String(r.category || "").toLowerCase().startsWith("domestic") ? "Domestic" : String(r.category || "").toLowerCase().startsWith("export") ? "Export" : "Other" },
  material: { label: "Material", key: r => /finished goods/i.test(r.category || "") ? "FG" : /raw material/i.test(r.category || "") ? "RM" : "Other" },
  location: { label: "Location", key: r => locationLabel(r.location) || "Unknown" },
  particulars: { label: "Customer", key: r => r.particulars || "Unknown" },
  voucher_type: { label: "Voucher Type", key: r => r.voucher_type || "Unknown" },
  voucher_date: { label: "Date", key: r => r.voucher_date || "Unknown" },
  month: { label: "Month", key: r => (r.voucher_date || "").slice(0, 7) || "Unknown" },
  gstin_uin: { label: "GSTIN/UIN", key: r => r.gstin_uin || "None" },
};

export const ANALYSIS_MEASURES = {
  gross_sum: { label: "Gross Sales", fn: rows => sumBy(rows, "gross_total"), format: money },
  taxable_sum: { label: "Taxable Value", fn: rows => sumBy(rows, "taxable_value"), format: money },
  gst_sum: { label: "GST", fn: rows => rows.reduce((a, r) => a + (+r.sgst_9pct || 0) + (+r.cgst_9pct || 0) + (+r.igst_18pct || 0), 0), format: money },
  qty_sum: { label: "Quantity", fn: rows => sumBy(rows, "quantity"), format: num },
  count: { label: "Record Count", fn: rows => rows.length, format: num },
  gross_avg: { label: "Avg Gross", fn: rows => rows.length ? sumBy(rows, "gross_total") / rows.length : 0, format: money },
};

export const PRODUCT_CHART_MEASURES = {
  value:     { label: "Total Value", get: g => g.value,    format: v => money(v) },
  quantity:  { label: "Quantity",    get: g => g.quantity, format: v => num(v) },
  avgRate:   { label: "Avg Rate",    get: g => g.avgRate || 0, format: v => money(v, true) },
  invoices:  { label: "Invoices",    get: g => g.invoices, format: v => num(v) },
  customers: { label: "Customers",   get: g => g.customers, format: v => num(v) },
};
