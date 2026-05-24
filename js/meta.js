import { money, num } from "./format.js";

export function setMeta(payload) {
  const t = new Date(payload.generated_at);
  const source = `Source: ${payload.source}`;
  const updated = `Updated ${t.toLocaleString()}`;
  for (const [src, gen] of [
    ["meta-source", "meta-generated"],
    ["records-meta-source", "records-meta-generated"],
    ["analysis-meta-source", "analysis-meta-generated"],
    ["kpi-meta-source", "kpi-meta-generated"],
    ["products-meta-source", "products-meta-generated"],
  ]) {
    document.getElementById(src).textContent = source;
    document.getElementById(gen).textContent = updated;
  }
}

export function setMetaError(message) {
  const label = "No data";
  for (const [src, gen] of [
    ["meta-source", "meta-generated"],
    ["records-meta-source", "records-meta-generated"],
    ["analysis-meta-source", "analysis-meta-generated"],
    ["kpi-meta-source", "kpi-meta-generated"],
    ["products-meta-source", "products-meta-generated"],
  ]) {
    document.getElementById(src).textContent = label;
    document.getElementById(gen).textContent = message;
  }
}

export function renderTotals(rows) {
  const gross = rows.reduce((a, r) => a + (Number(r.gross_total) || 0), 0);
  const gst =
    rows.reduce((a, r) => a + (Number(r.sgst_9pct) || 0), 0) +
    rows.reduce((a, r) => a + (Number(r.cgst_9pct) || 0), 0) +
    rows.reduce((a, r) => a + (Number(r.igst_18pct) || 0), 0);
  document.getElementById("totals").innerHTML = `
    <div><span class="t-label">Vouchers</span><span class="t-value">${num(rows.length)}</span></div>
    <div><span class="t-label">Gross</span><span class="t-value">${money(gross)}</span></div>
    <div><span class="t-label">GST</span><span class="t-value">${money(gst)}</span></div>
  `;
}
