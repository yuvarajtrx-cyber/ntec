import { money, num, pct, monthLabel } from "../../format.js";
import { CHART_PALETTE } from "./state.js";
import { grossGroups, invoiceBands, monthGroups, shortName } from "./data.js";

let stSalesChart = null;
let stCoverageChart = null;
let stMixChart = null;
let stBandChart = null;

function setPersonalOnly(isPersonal) {
  document.getElementById("st-kpi-strip").classList.toggle("hidden", isPersonal);
  document.getElementById("st-person-cards").classList.toggle("hidden", isPersonal);
  document.getElementById("st-performance-cards").classList.toggle("hidden", !isPersonal);
  document.getElementById("st-table-panel").classList.toggle("hidden", isPersonal);
  document.getElementById("st-mix-panel").classList.toggle("hidden", !isPersonal);
  document.getElementById("st-band-panel").classList.toggle("hidden", !isPersonal);
}

function destroyPersonalOnlyCharts() {
  if (stMixChart)  { stMixChart.destroy();  stMixChart  = null; }
  if (stBandChart) { stBandChart.destroy(); stBandChart = null; }
}

export function renderSalesCharts(groups) {
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

export function renderPersonalCharts(group) {
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
