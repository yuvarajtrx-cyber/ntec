import { state } from "../state.js";
import { ACCENT, ANALYSIS_DIMENSIONS, ANALYSIS_MEASURES } from "../constants.js";
import { money, num, escapeHtml, sumBy, debounce } from "../format.js";
import { normalizeLocationValue } from "../location.js";
import { productKey } from "../product-utils.js";
import { saleTypeMatches } from "../sale-type.js";

let analysisChart = null;
let PIVOT_DRILLDOWN = null; // { dimLabel, keyValue, rows }

function getAnalysisState() {
  return {
    dim: document.getElementById("analysis-dim").value,
    measure: document.getElementById("analysis-measure").value,
    chartType: document.getElementById("analysis-chart-type").value,
    sort: document.getElementById("analysis-sort").value,
    topN: Math.max(1, Number(document.getElementById("analysis-topn").value) || 20),
    q: document.getElementById("analysis-q").value.trim().toLowerCase(),
    category: document.getElementById("analysis-category").value,
    location: document.getElementById("analysis-location").value,
    month: document.getElementById("analysis-month").value,
    dateFrom: document.getElementById("analysis-date-from").value,
    dateTo: document.getElementById("analysis-date-to").value,
    product: document.getElementById("analysis-product").value,
  };
}

function rowContainsProduct(r, product) {
  if (!product) return true;
  const targetKey = productKey(product);
  const items = Array.isArray(r.line_items) ? r.line_items : [];
  return items.some(li => li && productKey(li.particulars) === targetKey);
}

function filterAnalysisRows(rows, s) {
  // Allow either bound alone: From only = "since X", To only = "up to Y".
  // If From > To we silently swap so a typo doesn't yield an empty set.
  let from = s.dateFrom || "";
  let to = s.dateTo || "";
  if (from && to && from > to) [from, to] = [to, from];

  return rows.filter(r => {
    if (!saleTypeMatches(r.category, s.category)) return false;
    if (s.location && normalizeLocationValue(r.location) !== s.location) return false;
    if (s.month && (r.voucher_date || "").slice(0, 7) !== s.month) return false;
    if (from && (!r.voucher_date || r.voucher_date < from)) return false;
    if (to && (!r.voucher_date || r.voucher_date > to)) return false;
    if (s.product && !rowContainsProduct(r, s.product)) return false;
    return true;
  });
}

function buildPivotGroups(rows, dim, measure) {
  const grouped = new Map();
  rows.forEach(r => {
    const key = dim.key(r);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(r);
  });
  return [...grouped.entries()].map(([key, groupRows]) => ({
    key,
    value: measure.fn(groupRows),
    gross: sumBy(groupRows, "gross_total"),
    taxable: sumBy(groupRows, "taxable_value"),
    gst: ANALYSIS_MEASURES.gst_sum.fn(groupRows),
    quantity: sumBy(groupRows, "quantity"),
    count: groupRows.length,
  }));
}

function sortPivotGroups(groups, sortKey) {
  const sorters = {
    "value-desc": (a, b) => b.value - a.value,
    "value-asc": (a, b) => a.value - b.value,
    "key-asc": (a, b) => String(a.key).localeCompare(String(b.key)),
    "key-desc": (a, b) => String(b.key).localeCompare(String(a.key)),
  };
  return groups.sort(sorters[sortKey] || sorters["value-desc"]);
}

function renderAnalysisSummary(rows, groups, measure) {
  const gross = sumBy(rows, "gross_total");
  const gst = ANALYSIS_MEASURES.gst_sum.fn(rows);
  document.getElementById("analysis-summary").innerHTML = `
    <div><span>Rows</span><strong>${num(rows.length)}</strong></div>
    <div><span>Groups</span><strong>${num(groups.length)}</strong></div>
    <div><span>${escapeHtml(measure.label)}</span><strong>${measure.format(measure.fn(rows))}</strong></div>
    <div><span>Gross</span><strong>${money(gross)}</strong></div>
    <div><span>GST</span><strong>${money(gst)}</strong></div>
  `;
}

function renderAnalysisChart(groups, dim, measure, chartType) {
  if (analysisChart) analysisChart.destroy();
  const chartGroups = groups.slice(0, chartType === "doughnut" ? 12 : groups.length);
  const labels = chartGroups.map(g => String(g.key).length > 28 ? `${String(g.key).slice(0, 26)}...` : String(g.key));
  const values = chartGroups.map(g => g.value);
  const type = chartType === "line" ? "line" : chartType === "doughnut" ? "doughnut" : "bar";
  const dataset = {
    data: values,
    backgroundColor: type === "line" ? "rgba(79, 70, 229, 0.12)" : ["#4f46e5", "#059669", "#d97706", "#dc2626", "#0891b2", "#7c3aed", "#64748b", "#db2777"],
    borderColor: ACCENT,
    borderRadius: type === "bar" ? 4 : 0,
    fill: type === "line",
    tension: 0.25,
  };

  analysisChart = new Chart(document.getElementById("analysis-chart"), {
    type,
    data: { labels, datasets: [dataset] },
    options: {
      indexAxis: type === "bar" ? "y" : "x",
      maintainAspectRatio: false,
      plugins: {
        legend: { display: type === "doughnut", position: "bottom" },
        tooltip: { callbacks: { label: c => `${c.label}: ${measure.format(type === "doughnut" ? c.parsed : type === "bar" ? c.parsed.x : c.parsed.y)}` } },
      },
      scales: type === "doughnut" ? {} : {
        x: { ticks: { callback: v => type === "bar" ? measure.format(v) : labels[v] || v } },
        y: { ticks: { callback: v => type === "bar" ? labels[v] || v : measure.format(v) } },
      },
    },
  });
  document.getElementById("analysis-chart-title").textContent = `${measure.label} by ${dim.label}`;
}

function renderAnalysisTable(groups, dim, measure) {
  document.getElementById("analysis-count").textContent = `${num(groups.length)} groups`;
  document.getElementById("analysis-table").innerHTML = `
    <thead>
      <tr>
        <th>${escapeHtml(dim.label)}</th>
        <th class="num">${escapeHtml(measure.label)}</th>
        <th class="num">Records</th>
        <th class="num">Taxable</th>
        <th class="num">GST</th>
        <th class="num">Gross</th>
        <th class="num">Quantity</th>
      </tr>
    </thead>
    <tbody>
      ${groups.map(g => `
        <tr class="row-clickable" data-pivot-key="${escapeHtml(String(g.key))}">
          <td>${escapeHtml(g.key)}</td>
          <td class="num strong">${measure.format(g.value)}</td>
          <td class="num">${num(g.count)}</td>
          <td class="num">${money(g.taxable)}</td>
          <td class="num">${money(g.gst)}</td>
          <td class="num">${money(g.gross)}</td>
          <td class="num">${num(g.quantity)}</td>
        </tr>
      `).join("") || `<tr><td colspan="7" class="txn-empty">No groups match your filters.</td></tr>`}
    </tbody>
  `;
}

function openPivotDrilldown(keyValue) {
  const s = getAnalysisState();
  const dim = ANALYSIS_DIMENSIONS[s.dim];
  if (!dim) return;

  // Apply the same filters as the pivot view, then narrow to the clicked key.
  const filteredRows = filterAnalysisRows(state.rows, s)
    .filter(r => String(dim.key(r)) === String(keyValue));

  PIVOT_DRILLDOWN = { dimLabel: dim.label, keyValue, rows: filteredRows };

  document.getElementById("pivot-drilldown-eyebrow").textContent = dim.label;
  document.getElementById("pivot-drilldown-title").textContent = keyValue;
  document.getElementById("pivot-drilldown-search").value = "";
  document.getElementById("pivot-drilldown-sort").value = "gross-desc";

  const modal = document.getElementById("pivot-drilldown");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  renderPivotDrilldown();
}

function closePivotDrilldown() {
  const modal = document.getElementById("pivot-drilldown");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  PIVOT_DRILLDOWN = null;
}

function renderPivotDrilldown() {
  if (!PIVOT_DRILLDOWN) return;
  const { rows } = PIVOT_DRILLDOWN;
  const q = document.getElementById("pivot-drilldown-search").value.trim().toLowerCase();
  const sort = document.getElementById("pivot-drilldown-sort").value;

  let filtered = rows;
  if (q) {
    filtered = rows.filter(r => {
      const hay = [r.voucher_no, r.particulars, r.gstin_uin, r.voucher_type, r.location, r.category]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  const cmp = {
    "gross-desc":    (a, b) => (Number(b.gross_total) || 0) - (Number(a.gross_total) || 0),
    "gross-asc":     (a, b) => (Number(a.gross_total) || 0) - (Number(b.gross_total) || 0),
    "date-desc":     (a, b) => String(b.voucher_date || "").localeCompare(String(a.voucher_date || "")),
    "date-asc":      (a, b) => String(a.voucher_date || "").localeCompare(String(b.voucher_date || "")),
    "customer-asc":  (a, b) => String(a.particulars || "").localeCompare(String(b.particulars || "")),
  }[sort] || ((a, b) => (Number(b.gross_total) || 0) - (Number(a.gross_total) || 0));
  filtered = [...filtered].sort(cmp);

  const gross = filtered.reduce((a, r) => a + (Number(r.gross_total) || 0), 0);
  const taxable = filtered.reduce((a, r) => a + (Number(r.taxable_value) || 0), 0);
  document.getElementById("pivot-drilldown-summary").textContent =
    `${num(filtered.length)} voucher${filtered.length === 1 ? "" : "s"}  ·  Taxable ${money(taxable)}  ·  Gross ${money(gross)}`;

  const tbody = document.querySelector("#pivot-drilldown-table tbody");
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="txn-empty">No vouchers match.</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(r => `
    <tr>
      <td>${escapeHtml(r.voucher_date || "")}</td>
      <td class="voucher">${escapeHtml(r.voucher_no || "")}</td>
      <td class="customer" title="${escapeHtml(r.particulars || "")}">${escapeHtml(r.particulars || "—")}</td>
      <td><span class="badge">${escapeHtml(r.category || "")}</span></td>
      <td>${escapeHtml(r.location || "—")}</td>
      <td>${escapeHtml(r.gstin_uin || "—")}</td>
      <td class="num">${r.quantity != null ? num(r.quantity) : "—"}</td>
      <td class="num">${r.taxable_value != null ? money(r.taxable_value) : "—"}</td>
      <td class="num">${r.gross_total != null ? money(r.gross_total) : "—"}</td>
    </tr>
  `).join("");
}

export function renderAnalysis() {
  const s = getAnalysisState();
  const dim = ANALYSIS_DIMENSIONS[s.dim];
  const measure = ANALYSIS_MEASURES[s.measure];
  const filteredRows = filterAnalysisRows(state.rows, s);
  let groups = buildPivotGroups(filteredRows, dim, measure);
  if (s.q) groups = groups.filter(g => String(g.key).toLowerCase().includes(s.q));
  sortPivotGroups(groups, s.sort);
  renderAnalysisSummary(filteredRows, groups, measure);
  const limitedGroups = groups.slice(0, s.topN);
  renderAnalysisChart(limitedGroups, dim, measure, s.chartType);
  renderAnalysisTable(limitedGroups, dim, measure);
}

export function wireAnalysis() {
  [
    "analysis-dim", "analysis-measure", "analysis-chart-type", "analysis-sort",
    "analysis-topn", "analysis-q", "analysis-category", "analysis-location",
    "analysis-month", "analysis-date-from", "analysis-date-to", "analysis-product",
  ].forEach(id => {
    const el = document.getElementById(id);
    const eventName = el.tagName === "INPUT" ? "input" : "change";
    el.addEventListener(eventName, debounce(renderAnalysis, eventName === "input" ? 150 : 0));
  });
  // Pivot drilldown: click any pivot row to open vouchers for that dim value
  document.getElementById("analysis-table").addEventListener("click", (e) => {
    const tr = e.target.closest("tr.row-clickable");
    if (!tr) return;
    const key = tr.dataset.pivotKey;
    if (key != null) openPivotDrilldown(key);
  });
  document.querySelectorAll("#pivot-drilldown [data-pivot-close]").forEach(el => {
    el.addEventListener("click", closePivotDrilldown);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("pivot-drilldown").classList.contains("hidden")) {
      closePivotDrilldown();
    }
  });
  ["pivot-drilldown-search", "pivot-drilldown-sort"].forEach(id => {
    const el = document.getElementById(id);
    const eventName = el.tagName === "INPUT" ? "input" : "change";
    el.addEventListener(eventName, debounce(renderPivotDrilldown, eventName === "input" ? 150 : 0));
  });
  document.getElementById("pivot-drilldown-reset").addEventListener("click", () => {
    document.getElementById("pivot-drilldown-search").value = "";
    document.getElementById("pivot-drilldown-sort").value = "gross-desc";
    renderPivotDrilldown();
  });
  document.getElementById("analysis-reset").addEventListener("click", () => {
    document.getElementById("analysis-dim").value = "category";
    document.getElementById("analysis-measure").value = "gross_sum";
    document.getElementById("analysis-chart-type").value = "bar";
    document.getElementById("analysis-sort").value = "value-desc";
    document.getElementById("analysis-topn").value = "20";
    document.getElementById("analysis-q").value = "";
    document.getElementById("analysis-category").value = "";
    document.getElementById("analysis-location").value = "";
    document.getElementById("analysis-month").value = "";
    document.getElementById("analysis-date-from").value = "";
    document.getElementById("analysis-date-to").value = "";
    document.getElementById("analysis-product").value = "";
    renderAnalysis();
  });
}
