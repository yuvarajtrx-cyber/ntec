import { money, num, pct, escapeHtml } from "../../format.js";
import { UNASSIGNED } from "./state.js";
import {
  aggregate, grossGroups, isDomestic, isExport, isFG, isRM, shortName,
} from "./data.js";

export function renderKpiStrip(rows, extra = {}) {
  const a = aggregate(rows);
  const cards = [
    ["Gross Sales", money(a.gross), "After GST"],
    ["Taxable Value", money(a.taxable), "Before GST"],
    ["GST", money(a.gst), "SGST + CGST + IGST"],
    ["Quantity", num(a.qty), "Units"],
    ["Invoices", num(a.invoices), extra.invoicesHint || ""],
  ];
  document.getElementById("st-kpi-strip").innerHTML = cards.map(([label, value, hint]) => `
    <div class="insight-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(hint)}</small>
    </div>
  `).join("");
}

export function renderPersonCards(groups) {
  const topSales = groups[0];
  const broadest = [...groups].sort((a, b) => b.customers - a.customers || b.gross - a.gross)[0];
  const avgLeader = [...groups].filter(g => g.invoices > 0).sort((a, b) => b.avgInvoice - a.avgInvoice)[0];
  const unassigned = groups.find(g => g.person === UNASSIGNED);
  const focused = [...groups].filter(g => g.person !== UNASSIGNED).sort((a, b) => b.concentration - a.concentration)[0];
  const cards = [
    {
      label: "Top Seller",
      value: topSales?.person || "—",
      hint: topSales ? `${money(topSales.gross)} across ${num(topSales.customers)} customers` : "No sales",
    },
    {
      label: "Widest Coverage",
      value: broadest?.person || "—",
      hint: broadest ? `${num(broadest.customers)} customers · ${num(broadest.invoices)} invoices` : "No customers",
    },
    {
      label: "Highest Avg Invoice",
      value: avgLeader?.person || "—",
      hint: avgLeader ? `${money(avgLeader.avgInvoice)} per invoice` : "No invoices",
    },
    {
      label: "Most Concentrated",
      value: focused?.person || "—",
      hint: focused ? `${pct(focused.concentration)} from ${shortName(focused.topCustomer, 24)}` : "No mapped sales",
    },
    {
      label: "Unassigned Sales",
      value: unassigned ? money(unassigned.gross) : money(0),
      hint: unassigned ? `${num(unassigned.customers)} customers need mapping` : "Mapping complete",
    },
  ];
  document.getElementById("st-person-cards").innerHTML = cards.map(card => `
    <div class="insight-card">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      <small>${escapeHtml(card.hint)}</small>
    </div>
  `).join("");
}

export function renderPerformanceCards(group) {
  const areaGroups = grossGroups(group.rows, r => r.category || "Other");
  const primaryArea = areaGroups[0];
  const primaryRows = primaryArea
    ? group.rows.filter(r => (r.category || "Other") === primaryArea.key)
    : [];
  const primaryAgg = aggregate(primaryRows);
  const primaryCustomer = grossGroups(primaryRows, r => r.particulars || "(no name)")[0];
  const fgGross = group.rows.reduce((a, r) => isFG(r.category) ? a + (+r.gross_total || 0) : a, 0);
  const rmGross = group.rows.reduce((a, r) => isRM(r.category) ? a + (+r.gross_total || 0) : a, 0);
  const domesticGross = group.rows.reduce((a, r) => isDomestic(r.category) ? a + (+r.gross_total || 0) : a, 0);
  const exportGross = group.rows.reduce((a, r) => isExport(r.category) ? a + (+r.gross_total || 0) : a, 0);
  const otherMaterialGross = Math.max(0, group.gross - fgGross - rmGross);
  const otherMarketGross = Math.max(0, group.gross - domesticGross - exportGross);
  const activeAreas = areaGroups.filter(g => g.gross > 0);
  const cards = [
    {
      label: "Primary Area",
      value: shortName(primaryArea?.key, 26),
      hint: primaryArea ? `${pct(group.gross ? primaryArea.gross / group.gross * 100 : 0)} · ${money(primaryArea.gross)}` : "No area sales",
    },
    {
      label: "FG / RM Split",
      value: `FG ${pct(group.gross ? fgGross / group.gross * 100 : 0)}`,
      hint: `RM ${pct(group.gross ? rmGross / group.gross * 100 : 0)} · Other ${pct(group.gross ? otherMaterialGross / group.gross * 100 : 0)}`,
    },
    {
      label: "Domestic / Export",
      value: `Dom ${pct(group.gross ? domesticGross / group.gross * 100 : 0)}`,
      hint: `Export ${pct(group.gross ? exportGross / group.gross * 100 : 0)} · Other ${pct(group.gross ? otherMarketGross / group.gross * 100 : 0)}`,
    },
    {
      label: "Area Breadth",
      value: num(activeAreas.length),
      hint: activeAreas.slice(0, 2).map(g => shortName(g.key, 18)).join(" + ") || "No active areas",
    },
    {
      label: "Primary Area Avg",
      value: money(primaryAgg.invoices ? primaryAgg.gross / primaryAgg.invoices : 0),
      hint: `${num(primaryAgg.invoices)} invoice${primaryAgg.invoices === 1 ? "" : "s"} in main area`,
    },
    {
      label: "Key Account In Area",
      value: shortName(primaryCustomer?.key, 26),
      hint: primaryCustomer ? `${money(primaryCustomer.gross)} in ${shortName(primaryArea?.key, 16)}` : "No primary-area customer",
    },
  ];
  document.getElementById("st-performance-cards").innerHTML = cards.map(card => `
    <div class="insight-card">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      <small>${escapeHtml(card.hint)}</small>
    </div>
  `).join("");
}
