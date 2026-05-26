import { state } from "../state.js";
import { money, num, pct, escapeHtml, sumBy, debounce, monthLabel } from "../format.js";
import { uniqueMonths } from "../rows.js";
import { uploadSalespersonFile } from "../api.js";

// Per-page state. Lives in this module (not global state) since nothing else needs it.
const ST = {
  view: "l0",
  selection: { person: null, customer: null },
  filters: {
    saleGroup: "",             // "" | "domestic" | "export" | "other"
    material: "",              // "" | "fg" | "rm"
    month: "",                 // "" | "YYYY-MM"
    dateFrom: "",
    dateTo: "",
    q: "",
  },
};

const UNASSIGNED = "Unassigned";
const CHART_PALETTE = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#4b5563"];
let stSalesChart = null;
let stCoverageChart = null;
let stMixChart = null;
let stBandChart = null;

function isDomestic(cat) { return /^domestic/i.test(cat || ""); }
function isExport(cat)   { return /^export/i.test(cat || ""); }
function isFG(cat)       { return /finished goods/i.test(cat || ""); }
function isRM(cat)       { return /raw material/i.test(cat || ""); }
function isOther(cat)    { return !isDomestic(cat) && !isExport(cat); }

function rowGst(r) {
  return (+r.sgst_9pct || 0) + (+r.cgst_9pct || 0) + (+r.igst_18pct || 0);
}

function applyFilters(rows) {
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

function aggregate(rows) {
  return {
    gross:    sumBy(rows, "gross_total"),
    taxable:  sumBy(rows, "taxable_value"),
    gst:      rows.reduce((a, r) => a + rowGst(r), 0),
    qty:      sumBy(rows, "quantity"),
    invoices: rows.length,
  };
}

function topGrossGroup(rows, keyFn) {
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

function latestDate(rows) {
  const dates = rows.map(r => r.voucher_date).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : "—";
}

function shortName(value, max = 28) {
  const s = String(value || "—");
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function renderKpiStrip(rows, extra = {}) {
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

function renderCrumbs() {
  const parts = [`<button class="crumb-link" data-crumb="l0">Sales Team Insights</button>`];
  if (ST.view === "person" && ST.selection.person) {
    parts.push(`<span class="crumb-sep">›</span>`);
    parts.push(`<span class="crumb-current">${escapeHtml(ST.selection.person)}</span>`);
  }
  document.getElementById("sales-team-crumbs").innerHTML = parts.join("");
}

function buildPersonGroups(rows) {
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

function renderPersonCards(groups) {
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

function grossGroups(rows, keyFn) {
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

function monthGroups(rows) {
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

function setPersonalOnly(isPersonal) {
  document.getElementById("st-kpi-strip").classList.toggle("hidden", isPersonal);
  document.getElementById("st-person-cards").classList.toggle("hidden", isPersonal);
  document.getElementById("st-performance-cards").classList.toggle("hidden", !isPersonal);
  document.getElementById("st-table-panel").classList.toggle("hidden", isPersonal);
  document.getElementById("st-mix-panel").classList.toggle("hidden", !isPersonal);
  document.getElementById("st-band-panel").classList.toggle("hidden", !isPersonal);
}

function renderPerformanceCards(group) {
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

function destroyPersonalOnlyCharts() {
  if (stMixChart) {
    stMixChart.destroy();
    stMixChart = null;
  }
  if (stBandChart) {
    stBandChart.destroy();
    stBandChart = null;
  }
}

function renderSalesCharts(groups) {
  setPersonalOnly(false);
  destroyPersonalOnlyCharts();
  const topGroups = groups.slice(0, 12);
  const labels = topGroups.map(g => shortName(g.person, 18));
  const colors = topGroups.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]);

  document.getElementById("st-sales-chart-title").textContent = "Sales By Person";
  document.getElementById("st-sales-chart-note").textContent =
    topGroups.length ? `${num(topGroups.length)} salesperson${topGroups.length === 1 ? "" : "s"}` : "No data";
  if (stSalesChart) stSalesChart.destroy();
  stSalesChart = new Chart(document.getElementById("st-sales-chart"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Gross sales",
        data: topGroups.map(g => g.gross),
        backgroundColor: colors,
        borderRadius: 5,
        maxBarThickness: 34,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ctx => topGroups[ctx[0].dataIndex]?.person || "",
            label: c => `Gross: ${money(c.parsed.y)}`,
            afterBody: ctx => {
              const g = topGroups[ctx[0].dataIndex];
              return g ? `${num(g.customers)} customers · ${num(g.invoices)} invoices` : "";
            },
          },
        },
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => money(v) } },
        x: { grid: { display: false } },
      },
    },
  });

  document.getElementById("st-coverage-chart-title").textContent = "Coverage";
  document.getElementById("st-coverage-chart-note").textContent =
    topGroups.length ? "Customers and invoices" : "No data";
  if (stCoverageChart) stCoverageChart.destroy();
  stCoverageChart = new Chart(document.getElementById("st-coverage-chart"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Customers",
          data: topGroups.map(g => g.customers),
          backgroundColor: "#2563eb",
          borderRadius: 5,
          maxBarThickness: 28,
        },
        {
          label: "Invoices",
          data: topGroups.map(g => g.invoices),
          backgroundColor: "#16a34a",
          borderRadius: 5,
          maxBarThickness: 28,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            title: ctx => topGroups[ctx[0].dataIndex]?.person || "",
            label: c => `${c.dataset.label}: ${num(c.parsed.y)}`,
          },
        },
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
        x: { grid: { display: false } },
      },
    },
  });
}

function renderPersonalCharts(group) {
  setPersonalOnly(true);
  const monthly = monthGroups(group.rows);
  document.getElementById("st-sales-chart-title").textContent = "Monthly Sales";
  document.getElementById("st-sales-chart-note").textContent =
    monthly.length ? `${num(monthly.length)} month${monthly.length === 1 ? "" : "s"}` : "No data";
  if (stSalesChart) stSalesChart.destroy();
  stSalesChart = new Chart(document.getElementById("st-sales-chart"), {
    type: "bar",
    data: {
      labels: monthly.map(g => monthLabel(g.key)),
      datasets: [{
        label: "Gross sales",
        data: monthly.map(g => g.gross),
        backgroundColor: "#2563eb",
        borderRadius: 5,
        maxBarThickness: 34,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `Gross: ${money(c.parsed.y)}` } },
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => money(v) } },
        x: { grid: { display: false } },
      },
    },
  });

  const customers = grossGroups(group.rows, r => r.particulars || "(no name)").slice(0, 10);
  document.getElementById("st-coverage-chart-title").textContent = "Top Customers";
  document.getElementById("st-coverage-chart-note").textContent =
    customers.length ? `${num(customers.length)} top customer${customers.length === 1 ? "" : "s"}` : "No data";
  if (stCoverageChart) stCoverageChart.destroy();
  stCoverageChart = new Chart(document.getElementById("st-coverage-chart"), {
    type: "bar",
    data: {
      labels: customers.map(g => shortName(g.key, 20)),
      datasets: [{
        label: "Gross sales",
        data: customers.map(g => g.gross),
        backgroundColor: customers.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]),
        borderRadius: 5,
        maxBarThickness: 28,
      }],
    },
    options: {
      indexAxis: "y",
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ctx => customers[ctx[0].dataIndex]?.key || "",
            label: c => `Gross: ${money(c.parsed.x)}`,
            afterBody: ctx => {
              const g = customers[ctx[0].dataIndex];
              return g ? `${num(g.invoices)} invoice${g.invoices === 1 ? "" : "s"}` : "";
            },
          },
        },
      },
      scales: {
        x: { beginAtZero: true, ticks: { callback: v => money(v) } },
        y: { grid: { display: false } },
      },
    },
  });

  const mix = grossGroups(group.rows, r => r.category || "Other");
  document.getElementById("st-mix-chart-note").textContent =
    mix.length ? `${num(mix.length)} sale type${mix.length === 1 ? "" : "s"}` : "No data";
  if (stMixChart) stMixChart.destroy();
  stMixChart = new Chart(document.getElementById("st-mix-chart"), {
    type: "bar",
    data: {
      labels: mix.map(g => shortName(g.key, 18)),
      datasets: [{
        label: "Share of gross",
        data: mix.map(g => group.gross ? (g.gross / group.gross) * 100 : 0),
        backgroundColor: mix.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]),
        borderRadius: 5,
        maxBarThickness: 34,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ctx => mix[ctx[0].dataIndex]?.key || "",
            label: c => `Share: ${pct(c.parsed.y)}`,
            afterBody: ctx => {
              const g = mix[ctx[0].dataIndex];
              return g ? `Gross: ${money(g.gross)} · ${num(g.invoices)} invoices` : "";
            },
          },
        },
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => `${v}%` }, suggestedMax: 100 },
        x: { grid: { display: false } },
      },
    },
  });

  const bands = invoiceBands(group.rows);
  document.getElementById("st-band-chart-note").textContent =
    bands.some(b => b.count) ? "Invoice size distribution" : "No invoices";
  if (stBandChart) stBandChart.destroy();
  stBandChart = new Chart(document.getElementById("st-band-chart"), {
    type: "bar",
    data: {
      labels: bands.map(b => b.label),
      datasets: [
        {
          label: "Invoices",
          data: bands.map(b => b.count),
          backgroundColor: "#0891b2",
          borderRadius: 5,
          maxBarThickness: 34,
        },
        {
          label: "Gross sales",
          data: bands.map(b => b.gross),
          backgroundColor: "#f59e0b",
          borderRadius: 5,
          maxBarThickness: 34,
          yAxisID: "gross",
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: c => c.dataset.yAxisID === "gross"
              ? `Gross: ${money(c.parsed.y)}`
              : `Invoices: ${num(c.parsed.y)}`,
          },
        },
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
        gross: {
          beginAtZero: true,
          position: "right",
          grid: { drawOnChartArea: false },
          ticks: { callback: v => money(v) },
        },
        x: { grid: { display: false } },
      },
    },
  });
}

function invoiceBands(rows) {
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

function renderL0(rows) {
  document.getElementById("st-panel-title").textContent = "Salespersons";

  const groups = buildPersonGroups(rows);

  document.getElementById("st-panel-count").textContent =
    `${num(groups.length)} salesperson${groups.length === 1 ? "" : "s"}`;

  document.getElementById("st-table").innerHTML = `
    <thead>
      <tr>
        <th>Salesperson</th>
        <th>Key Insight</th>
        <th>Top Customer</th>
        <th>Sales Mix</th>
        <th class="num">Avg Invoice</th>
        <th>Last Sale</th>
        <th class="num">Customers</th>
        <th class="num">Invoices</th>
        <th class="num">Gross</th>
      </tr>
    </thead>
    <tbody>
      ${groups.length ? groups.map(g => `
        <tr class="row-clickable" data-person="${escapeHtml(g.person)}">
          <td><strong>${escapeHtml(g.person)}</strong></td>
          <td title="Top customer contributes ${escapeHtml(pct(g.concentration))} of this salesperson's sales">
            ${escapeHtml(pct(g.concentration))} from top customer
          </td>
          <td title="${escapeHtml(g.topCustomer)}">
            ${escapeHtml(shortName(g.topCustomer))}
            <small class="table-subtext">${escapeHtml(money(g.topCustomerGross))}</small>
          </td>
          <td title="${escapeHtml(g.topCategory)}">
            ${escapeHtml(shortName(g.topCategory, 22))}
            <small class="table-subtext">${escapeHtml(pct(g.topCategoryShare))}</small>
          </td>
          <td class="num">${money(g.avgInvoice)}</td>
          <td>${escapeHtml(g.lastSale)}</td>
          <td class="num">${num(g.customers)}</td>
          <td class="num">${num(g.invoices)}</td>
          <td class="num strong">${money(g.gross)}</td>
        </tr>
      `).join("") : `<tr><td colspan="9" class="txn-empty">No data for the current filters.</td></tr>`}
    </tbody>
  `;

  renderKpiStrip(rows);
  renderPersonCards(groups);
  renderSalesCharts(groups);
}

function renderPersonDetail(rows) {
  const person = ST.selection.person;
  const allGroups = buildPersonGroups(rows);
  const group = allGroups.find(g => g.person === person);
  document.getElementById("st-panel-title").textContent = `${person} · Analytics`;

  if (!group) {
    renderKpiStrip([]);
    document.getElementById("st-performance-cards").innerHTML = "";
    renderPersonalCharts({ person, rows: [], gross: 0 });
    return;
  }
  renderPerformanceCards(group);
  renderPersonalCharts(group);
}

function refreshMonthOptions() {
  const sel = document.getElementById("st-month");
  if (!sel) return;
  const currentVal = sel.value;
  const months = uniqueMonths(state.rows);
  sel.innerHTML = `<option value="">All</option>` + months.map(m =>
    `<option value="${escapeHtml(m)}">${escapeHtml(monthLabel(m))}</option>`
  ).join("");
  if (months.includes(currentVal)) sel.value = currentVal;
}

function refreshMetaLine() {
  document.getElementById("sales-team-meta-source").textContent =
    state.rows.length ? "Sales register" : "No data loaded";
  document.getElementById("sales-team-meta-count").textContent =
    state.rows.length ? `${num(state.rows.length)} invoice rows` : "—";
}

export function renderSalesTeam() {
  refreshMetaLine();
  refreshMonthOptions();
  renderCrumbs();
  const filtered = applyFilters(state.rows);
  if (ST.view === "person") renderPersonDetail(filtered);
  else renderL0(filtered);
}

export function wireSalesTeam() {
  const bind = (id, evt, fn) => document.getElementById(id).addEventListener(evt, fn);

  bind("st-sale-group", "change", e => { ST.filters.saleGroup = e.target.value; renderSalesTeam(); });
  bind("st-material",   "change", e => { ST.filters.material  = e.target.value; renderSalesTeam(); });
  bind("st-month",      "change", e => { ST.filters.month     = e.target.value; renderSalesTeam(); });
  bind("st-date-from",  "change", e => { ST.filters.dateFrom  = e.target.value; renderSalesTeam(); });
  bind("st-date-to",    "change", e => { ST.filters.dateTo    = e.target.value; renderSalesTeam(); });
  bind("st-q",          "input",  debounce(e => { ST.filters.q = e.target.value; renderSalesTeam(); }, 200));

  bind("st-reset", "click", () => {
    ST.filters = { saleGroup: "", material: "", month: "", dateFrom: "", dateTo: "", q: "" };
    ST.view = "l0";
    ST.selection = { person: null, customer: null };
    document.getElementById("st-sale-group").value = "";
    document.getElementById("st-material").value = "";
    document.getElementById("st-month").value = "";
    document.getElementById("st-date-from").value = "";
    document.getElementById("st-date-to").value = "";
    document.getElementById("st-q").value = "";
    renderSalesTeam();
  });

  document.getElementById("st-table").addEventListener("click", e => {
    const tr = e.target.closest("tr.row-clickable");
    if (!tr || !tr.dataset.person) return;
    ST.view = "person";
    ST.selection = { person: tr.dataset.person, customer: null };
    renderSalesTeam();
  });

  document.getElementById("sales-team-crumbs").addEventListener("click", e => {
    const b = e.target.closest("button.crumb-link");
    if (!b) return;
    ST.view = "l0";
    ST.selection = { person: null, customer: null };
    renderSalesTeam();
  });

  // Upload mapping
  bind("sp-upload-btn", "click", () => document.getElementById("sp-upload-input").click());
  bind("sp-upload-input", "change", e => {
    const f = e.target.files && e.target.files[0];
    if (f) uploadSalespersonFile(f);
    e.target.value = "";
  });
}
