import { state } from "../state.js";
import { CHART_PALETTE, KPI_DEFAULT_SETTINGS } from "../constants.js";
import {
  money, num, pct, escapeHtml,
  addDays, addMonths, daysBetween, monthLabel,
  debounce,
} from "../format.js";
import { getReferenceDate } from "../rows.js";
import { buildHomeTimeline } from "./home.js";

let kpiConcentrationChart = null;
let kpiRepeatChart = null;

function getKpiRange() {
  const refDate = getReferenceDate(state.rows);
  if (state.kpiPeriod === "all") {
    const dates = state.rows.map(r => r.voucher_date).filter(Boolean).sort();
    const start = dates[0] || "";
    const end = dates[dates.length - 1] || refDate;
    return { start, end, refDate: end || refDate, label: start ? `${start} → ${end}` : "No data" };
  }
  if (state.kpiPeriod === "custom") {
    let start = document.getElementById("kpi-date-from").value;
    let end = document.getElementById("kpi-date-to").value || refDate;
    if (start && end && start > end) [start, end] = [end, start];
    return { start, end, refDate: end || refDate, label: start ? `${start} → ${end}` : `Up to ${end}` };
  }
  const buckets = buildHomeTimeline(state.kpiPeriod, refDate);
  const start = buckets[0]?.start || "";
  const end = buckets[buckets.length - 1]?.end || refDate;
  const label = buckets.length ? `${start} → ${end}` : "No range";
  return { start, end, refDate: end, label };
}

function filterRowsByDate(rows, start, end) {
  return rows.filter(r => {
    if (!r.voucher_date) return false;
    if (start && r.voucher_date < start) return false;
    if (end && r.voucher_date > end) return false;
    return true;
  });
}

function customerName(r) {
  return r.particulars || "Unknown";
}

function aggregateCustomers(rows) {
  const map = new Map();
  rows.forEach(r => {
    const name = customerName(r);
    const current = map.get(name) || {
      name,
      invoices: 0,
      revenue: 0,
      taxable: 0,
      dates: [],
      gstin: r.gstin_uin || "",
      lastDate: "",
      firstDate: "",
    };
    current.invoices += 1;
    current.revenue += Number(r.gross_total) || 0;
    current.taxable += Number(r.taxable_value) || 0;
    if (r.gstin_uin && !current.gstin) current.gstin = r.gstin_uin;
    if (r.voucher_date) current.dates.push(r.voucher_date);
    map.set(name, current);
  });
  return [...map.values()].map(c => {
    c.dates = [...new Set(c.dates)].sort();
    c.firstDate = c.dates[0] || "";
    c.lastDate = c.dates[c.dates.length - 1] || "";
    return c;
  });
}

function calculateRevenueConcentration(customers, targetPct) {
  const sorted = [...customers].sort((a, b) => b.revenue - a.revenue);
  const total = sorted.reduce((a, c) => a + c.revenue, 0);
  let running = 0;
  let targetCount = 0;
  const points = sorted.map((c, idx) => {
    running += c.revenue;
    const revenuePct = total ? (running / total) * 100 : 0;
    if (!targetCount && revenuePct >= targetPct) targetCount = idx + 1;
    return {
      customerPct: sorted.length ? ((idx + 1) / sorted.length) * 100 : 0,
      revenuePct,
      name: c.name,
      revenue: c.revenue,
    };
  });
  return { sorted, points, total, targetCount: targetCount || sorted.length };
}

function orderGapStats(dates) {
  if (dates.length < 2) return { avg: null, stdDev: null, gaps: [] };
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
  const avg = gaps.reduce((a, v) => a + v, 0) / gaps.length;
  if (gaps.length < 2) return { avg, stdDev: null, gaps };
  const variance = gaps.reduce((a, v) => a + Math.pow(v - avg, 2), 0) / gaps.length;
  return { avg, stdDev: Math.sqrt(variance), gaps };
}

function cadenceRisk(daysSinceLast, avgGap, stdDev, settings) {
  if (avgGap == null || stdDev == null) return { label: "Needs history", score: 0, overdueBy: 0 };
  const watchAt = avgGap + stdDev * settings.watchStdDev;
  const highAt = avgGap + stdDev * settings.highStdDev;
  if (daysSinceLast > highAt) return { label: "High Risk", score: 2, overdueBy: daysSinceLast - highAt };
  if (daysSinceLast > watchAt) return { label: "Watch", score: 1, overdueBy: daysSinceLast - watchAt };
  return { label: "Normal", score: 0, overdueBy: 0 };
}

function buildCohorts(allRows, rangeStart, rangeEnd, settings) {
  const allCustomers = aggregateCustomers(allRows);
  const rowsByCustomer = new Map();
  allRows.forEach(r => {
    const name = customerName(r);
    if (!rowsByCustomer.has(name)) rowsByCustomer.set(name, []);
    rowsByCustomer.get(name).push(r);
  });

  return allCustomers
    .map(c => {
      const firstMonth = (c.firstDate || "").slice(0, 7);
      if (!firstMonth) return null;
      if (rangeStart && firstMonth < rangeStart.slice(0, 7)) return null;
      if (rangeEnd && firstMonth > rangeEnd.slice(0, 7)) return null;
      const customerRows = rowsByCustomer.get(c.name) || [];
      const cells = [];
      for (let i = 0; i < settings.months; i++) {
        const month = addMonths(firstMonth, i);
        const invoices = customerRows.filter(r => (r.voucher_date || "").slice(0, 7) === month).length;
        cells.push(invoices >= settings.minInvoices);
      }
      return { cohort: firstMonth, size: 1, cells };
    })
    .filter(Boolean)
    .reduce((acc, row) => {
      const current = acc.get(row.cohort) || { cohort: row.cohort, size: 0, retained: Array(settings.months).fill(0) };
      current.size += 1;
      row.cells.forEach((active, idx) => { if (active) current.retained[idx] += 1; });
      acc.set(row.cohort, current);
      return acc;
    }, new Map());
}

function getKpiConfigDefinitions() {
  return {
    concentration: {
      title: "Customer Concentration",
      help: "Tune the revenue threshold and how many top customers appear in the concentration chart.",
      fields: [
        { key: "targetPct", label: "Revenue target %", type: "number", min: 50, max: 99 },
        { key: "topCustomers", label: "Chart customers", type: "number", min: 5, max: 100 },
      ],
    },
    repeat: {
      title: "Repeat-Buy Rate",
      help: "Define how many invoices count as a repeat customer.",
      fields: [
        { key: "minInvoices", label: "Repeat invoice count", type: "number", min: 2, max: 20 },
      ],
    },
    cohort: {
      title: "Cohort Retention",
      help: "Choose how many months to show and the activity threshold per month.",
      fields: [
        { key: "months", label: "Months to show", type: "number", min: 3, max: 12 },
        { key: "minInvoices", label: "Active if invoices >=", type: "number", min: 1, max: 10 },
      ],
    },
    dormant: {
      title: "Dormant Customers",
      help: "Control the silence threshold and list length for call-list style follow-up.",
      fields: [
        { key: "days", label: "Dormant after days", type: "number", min: 30, max: 365 },
        { key: "limit", label: "Rows to show", type: "number", min: 5, max: 100 },
      ],
    },
    cadence: {
      title: "Order Cadence",
      help: "Flag customers whose silence exceeds their average order gap plus normal variation.",
      fields: [
        { key: "minInvoices", label: "Minimum invoices", type: "number", min: 3, max: 20 },
        { key: "watchStdDev", label: "Watch at avg + SD", type: "number", min: 0, max: 5, step: 0.5 },
        { key: "highStdDev", label: "High risk at avg + SD", type: "number", min: 0.5, max: 6, step: 0.5 },
        { key: "limit", label: "Rows to show", type: "number", min: 5, max: 100 },
      ],
    },
  };
}

function renderKpiConfig() {
  const defs = getKpiConfigDefinitions();
  const def = defs[state.kpiActive] || defs.concentration;
  const settings = state.kpiSettings[state.kpiActive];
  document.getElementById("kpi-config-title").textContent = def.title;
  document.getElementById("kpi-config-help").textContent = def.help;
  document.getElementById("kpi-config-fields").innerHTML = def.fields.map(field => `
    <label>${escapeHtml(field.label)}
      <input
        type="${escapeHtml(field.type)}"
        data-kpi-setting="${escapeHtml(field.key)}"
        min="${escapeHtml(field.min ?? "")}"
        max="${escapeHtml(field.max ?? "")}"
        step="${escapeHtml(field.step ?? 1)}"
        value="${escapeHtml(settings[field.key])}"
      />
    </label>
  `).join("");
}

function renderKpiSummary(rows, customers, metrics) {
  const cards = [
    {
      id: "concentration",
      label: "Revenue Concentration",
      value: `${num(metrics.concentration.targetCount)} customers`,
      hint: `${pct(metrics.concentration.customerPct)} drive ${state.kpiSettings.concentration.targetPct}% revenue`,
    },
    {
      id: "repeat",
      label: "Repeat-Buy Rate",
      value: pct(metrics.repeatRate),
      hint: `${num(metrics.repeatCustomers)} of ${num(customers.length)} customers`,
    },
    {
      id: "cohort",
      label: "Cohort Retention",
      value: pct(metrics.latestRetention),
      hint: `Latest month ${metrics.latestRetentionLabel}`,
    },
    {
      id: "dormant",
      label: "Dormant Customers",
      value: num(metrics.dormant.length),
      hint: `Silent ${num(state.kpiSettings.dormant.days)}+ days`,
    },
    {
      id: "cadence",
      label: "Order Cadence Risk",
      value: num(metrics.overdue.length),
      hint: `Avg gap + ${state.kpiSettings.cadence.watchStdDev} SD`,
    },
  ];
  document.getElementById("kpi-summary").innerHTML = cards.map(card => `
    <button class="insight-card kpi-card ${state.kpiActive === card.id ? "active" : ""}" type="button" data-kpi="${escapeHtml(card.id)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      <small>${escapeHtml(card.hint)}</small>
    </button>
  `).join("");
}

function renderKpiConcentration(concentration) {
  const select = document.getElementById("kpi-concentration-topn");
  const topN = Math.max(1, Number(select?.value) || state.kpiSettings.concentration.topCustomers);
  const customers = concentration.sorted.slice(0, topN);
  const colors = customers.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]);
  const box = document.getElementById("kpi-concentration-chart").closest(".chart-box");
  if (box) box.style.height = `${Math.max(380, customers.length * 24 + 48)}px`;

  if (kpiConcentrationChart) kpiConcentrationChart.destroy();
  kpiConcentrationChart = new Chart(document.getElementById("kpi-concentration-chart"), {
    type: "bar",
    data: {
      labels: customers.map(c => String(c.name).length > 24 ? `${String(c.name).slice(0, 22)}...` : String(c.name)),
      datasets: [
        {
          label: "Revenue",
          data: customers.map(c => c.revenue),
          backgroundColor: colors,
          borderRadius: 5,
          maxBarThickness: 28,
        },
      ],
    },
    options: {
      indexAxis: "y",
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ctx => customers[ctx[0].dataIndex]?.name || "",
            label: c => `Revenue: ${money(c.parsed.x)}`,
            afterBody: ctx => `${num(customers[ctx[0].dataIndex]?.invoices || 0)} invoice${(customers[ctx[0].dataIndex]?.invoices || 0) === 1 ? "" : "s"}`,
          },
        },
      },
      scales: {
        x: { ticks: { callback: v => money(v) }, beginAtZero: true },
        y: { grid: { display: false } },
      },
    },
  });
}

function renderKpiRepeatChart(customers, repeatCustomers) {
  const oneTime = Math.max(0, customers.length - repeatCustomers);
  const colors = CHART_PALETTE.slice(0, 2);
  document.getElementById("kpi-repeat-note").textContent =
    customers.length ? `${pct((repeatCustomers / customers.length) * 100)} of customers` : "No data";

  if (kpiRepeatChart) kpiRepeatChart.destroy();
  kpiRepeatChart = new Chart(document.getElementById("kpi-repeat-chart"), {
    type: "bar",
    data: {
      labels: ["Repeat", "One-time"],
      datasets: [{
        label: "Customers",
        data: [repeatCustomers, oneTime],
        backgroundColor: colors,
        borderRadius: 6,
        maxBarThickness: 56,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `${num(c.parsed.y)} customers` } },
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
        x: { grid: { display: false } },
      },
    },
  });
}

function renderConcentrationTable(concentration) {
  const rows = concentration.sorted;
  document.getElementById("kpi-concentration-table-note").textContent =
    `${num(rows.length)} customer${rows.length === 1 ? "" : "s"}`;
  document.getElementById("kpi-concentration-table").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Customer</th>
          <th class="num">Revenue</th>
          <th class="num">Share</th>
          <th class="num">Invoices</th>
          <th>Last Bought</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(c => `
          <tr>
            <td title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</td>
            <td class="num strong">${money(c.revenue)}</td>
            <td class="num">${pct(concentration.total ? (c.revenue / concentration.total) * 100 : 0)}</td>
            <td class="num">${num(c.invoices)}</td>
            <td>${escapeHtml(c.lastDate || "—")}</td>
          </tr>
        `).join("") || `<tr><td colspan="5" class="txn-empty">No customers in this period.</td></tr>`}
      </tbody>
    </table>
  `;
}

function renderRepeatTable(customers) {
  const minInvoices = state.kpiSettings.repeat.minInvoices;
  const rows = customers
    .filter(c => c.invoices >= minInvoices)
    .sort((a, b) => b.revenue - a.revenue);
  document.getElementById("kpi-repeat-table-note").textContent =
    `${num(rows.length)} repeat customer${rows.length === 1 ? "" : "s"}`;
  document.getElementById("kpi-repeat-table").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Customer</th>
          <th class="num">Invoices</th>
          <th class="num">Revenue</th>
          <th>First Bought</th>
          <th>Last Bought</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(c => `
          <tr>
            <td title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</td>
            <td class="num strong">${num(c.invoices)}</td>
            <td class="num">${money(c.revenue)}</td>
            <td>${escapeHtml(c.firstDate || "—")}</td>
            <td>${escapeHtml(c.lastDate || "—")}</td>
          </tr>
        `).join("") || `<tr><td colspan="5" class="txn-empty">No repeat customers at this threshold.</td></tr>`}
      </tbody>
    </table>
  `;
}

function renderCohortTable(cohortMap, settings) {
  const rows = [...cohortMap.values()].sort((a, b) => b.cohort.localeCompare(a.cohort));
  document.getElementById("kpi-cohort-note").textContent = `${num(rows.length)} cohorts`;
  const headers = Array.from({ length: settings.months }, (_, i) => `<th class="num">M+${i}</th>`).join("");
  document.getElementById("kpi-cohort-table").innerHTML = `
    <table>
      <thead>
        <tr><th>Cohort</th><th class="num">Customers</th>${headers}</tr>
      </thead>
      <tbody>
        ${rows.map(row => `
          <tr>
            <td>${escapeHtml(monthLabel(row.cohort))}</td>
            <td class="num strong">${num(row.size)}</td>
            ${row.retained.map(v => `<td class="num">${pct(row.size ? (v / row.size) * 100 : 0)}</td>`).join("")}
          </tr>
        `).join("") || `<tr><td colspan="${settings.months + 2}" class="txn-empty">No cohorts in this range.</td></tr>`}
      </tbody>
    </table>
  `;
}

function renderDormantTable(dormant) {
  const settings = state.kpiSettings.dormant;
  document.getElementById("kpi-dormant-note").textContent = `${num(dormant.length)} customers`;
  const rows = dormant.slice(0, settings.limit);
  document.getElementById("kpi-dormant-table").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Customer</th><th>Last Bought</th><th class="num">Silent Days</th><th class="num">Revenue</th><th class="num">Invoices</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(c => `
          <tr>
            <td title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</td>
            <td>${escapeHtml(c.lastDate || "—")}</td>
            <td class="num strong">${num(c.silentDays)}</td>
            <td class="num">${money(c.revenue)}</td>
            <td class="num">${num(c.invoices)}</td>
          </tr>
        `).join("") || `<tr><td colspan="5" class="txn-empty">No dormant customers at this threshold.</td></tr>`}
      </tbody>
    </table>
  `;
}

function renderCadenceTable(overdue) {
  const settings = state.kpiSettings.cadence;
  document.getElementById("kpi-cadence-note").textContent = `${num(overdue.length)} customers at watch/high risk`;
  const rows = overdue.slice(0, settings.limit);
  document.getElementById("kpi-cadence-table").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Customer</th><th>Risk</th><th>Last Bought</th><th class="num">Avg Gap</th><th class="num">Std Dev</th><th class="num">Days Since</th><th class="num">Overdue By</th><th class="num">Revenue</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(c => `
          <tr>
            <td title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</td>
            <td><span class="badge">${escapeHtml(c.riskLabel)}</span></td>
            <td>${escapeHtml(c.lastDate || "—")}</td>
            <td class="num">${num(Math.round(c.avgGap))}</td>
            <td class="num">${c.stdDev == null ? "—" : num(Math.round(c.stdDev))}</td>
            <td class="num strong">${num(c.daysSinceLast)}</td>
            <td class="num">${num(Math.round(c.overdueBy))}</td>
            <td class="num">${money(c.revenue)}</td>
          </tr>
        `).join("") || `<tr><td colspan="8" class="txn-empty">No customers are beyond their configured cadence.</td></tr>`}
      </tbody>
    </table>
  `;
}

function renderSelectedKpiDetail({ concentration, customers, repeatCustomers, cohortMap, dormant, cadenceCustomers }) {
  document.querySelectorAll("[data-kpi-detail]").forEach(section => {
    section.classList.toggle("hidden", section.dataset.kpiDetail !== state.kpiActive);
  });

  if (state.kpiActive === "concentration") {
    renderKpiConcentration(concentration);
    renderConcentrationTable(concentration);
  } else if (state.kpiActive === "repeat") {
    renderKpiRepeatChart(customers, repeatCustomers);
    renderRepeatTable(customers);
  } else if (state.kpiActive === "cohort") {
    renderCohortTable(cohortMap, state.kpiSettings.cohort);
  } else if (state.kpiActive === "dormant") {
    renderDormantTable(dormant);
  } else if (state.kpiActive === "cadence") {
    renderCadenceTable(cadenceCustomers);
  }
}

export function renderKpi(options = {}) {
  const range = getKpiRange();
  const rows = filterRowsByDate(state.rows, range.start, range.end);
  const customers = aggregateCustomers(rows);
  const allCustomersToRef = aggregateCustomers(filterRowsByDate(state.rows, "", range.refDate));
  const concentration = calculateRevenueConcentration(customers, state.kpiSettings.concentration.targetPct);
  const repeatCustomers = customers.filter(c => c.invoices >= state.kpiSettings.repeat.minInvoices).length;
  const repeatRate = customers.length ? (repeatCustomers / customers.length) * 100 : 0;
  const cohortMap = buildCohorts(state.rows, range.start, range.end, state.kpiSettings.cohort);
  const cohortRows = [...cohortMap.values()].sort((a, b) => a.cohort.localeCompare(b.cohort));
  const latestCohort = cohortRows[cohortRows.length - 1];
  const latestRetention = latestCohort && latestCohort.size
    ? (latestCohort.retained[Math.min(1, latestCohort.retained.length - 1)] / latestCohort.size) * 100
    : 0;
  const dormantCutoff = addDays(range.refDate, -state.kpiSettings.dormant.days);
  const dormant = allCustomersToRef
    .filter(c => c.lastDate && c.lastDate <= dormantCutoff)
    .map(c => ({ ...c, silentDays: daysBetween(c.lastDate, range.refDate) }))
    .sort((a, b) => b.revenue - a.revenue);
  const cadenceCustomers = customers
    .map(c => {
      const gapStats = orderGapStats(c.dates);
      const daysSinceLast = c.lastDate ? daysBetween(c.lastDate, range.refDate) : 0;
      const risk = cadenceRisk(daysSinceLast, gapStats.avg, gapStats.stdDev, state.kpiSettings.cadence);
      return {
        ...c,
        avgGap: gapStats.avg,
        stdDev: gapStats.stdDev,
        daysSinceLast,
        overdueBy: risk.overdueBy,
        riskLabel: risk.label,
        riskScore: risk.score,
      };
    })
    .filter(c => c.invoices >= state.kpiSettings.cadence.minInvoices && c.avgGap != null && c.stdDev != null && c.riskScore > 0)
    .sort((a, b) => b.riskScore - a.riskScore || b.overdueBy - a.overdueBy);

  const customerPct = customers.length ? (concentration.targetCount / customers.length) * 100 : 0;
  document.getElementById("kpi-range-label").textContent = `${range.label} · ${num(rows.length)} invoices · ${num(customers.length)} customers`;
  renderKpiSummary(rows, customers, {
    concentration: { ...concentration, customerPct },
    repeatRate,
    repeatCustomers,
    latestRetention,
    latestRetentionLabel: latestCohort ? monthLabel(latestCohort.cohort) : "—",
    dormant,
    overdue: cadenceCustomers,
  });
  if (!options.preserveConfig) renderKpiConfig();
  renderSelectedKpiDetail({ concentration, customers, repeatCustomers, cohortMap, dormant, cadenceCustomers });
}

export function wireKpi() {
  document.getElementById("kpi-period").addEventListener("change", (e) => {
    state.kpiPeriod = e.target.value;
    renderKpi();
  });
  ["kpi-date-from", "kpi-date-to"].forEach(id => {
    document.getElementById(id).addEventListener("change", () => {
      state.kpiPeriod = "custom";
      document.getElementById("kpi-period").value = "custom";
      renderKpi();
    });
  });
  document.getElementById("kpi-global-reset").addEventListener("click", () => {
    state.kpiPeriod = "1y";
    document.getElementById("kpi-period").value = "1y";
    document.getElementById("kpi-date-from").value = "";
    document.getElementById("kpi-date-to").value = "";
    renderKpi();
  });
  document.getElementById("kpi-summary").addEventListener("click", (e) => {
    const card = e.target.closest("[data-kpi]");
    if (!card) return;
    state.kpiActive = card.dataset.kpi;
    renderKpi();
  });
  document.getElementById("kpi-config-fields").addEventListener("input", (e) => {
    const field = e.target.closest("[data-kpi-setting]");
    if (!field) return;
    const key = field.dataset.kpiSetting;
    const value = Number(field.value);
    if (!Number.isFinite(value)) return;
    state.kpiSettings[state.kpiActive][key] = value;
    renderKpi({ preserveConfig: true });
  });
  document.getElementById("kpi-config-reset").addEventListener("click", () => {
    state.kpiSettings[state.kpiActive] = { ...KPI_DEFAULT_SETTINGS[state.kpiActive] };
    renderKpi();
  });
  document.getElementById("kpi-concentration-topn").addEventListener("change", renderKpi);
}
