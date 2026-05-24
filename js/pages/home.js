import { state } from "../state.js";
import { ACCENT, HOME_RANGES } from "../constants.js";
import { money, num, escapeHtml, isoDate, sumBy, groupRows } from "../format.js";
import { locationLabel } from "../location.js";
import { getReferenceDate } from "../rows.js";
import { renderTotals } from "../meta.js";

let dailyChart = null;
let saleTypeChart = null;
let cumulativeChart = null;

function renderInsightCards(rows) {
  const gross = sumBy(rows, "gross_total");
  const taxable = sumBy(rows, "taxable_value");
  const gst = rows.reduce((a, r) => a + (+r.sgst_9pct || 0) + (+r.cgst_9pct || 0) + (+r.igst_18pct || 0), 0);
  const customers = new Set(rows.map(r => r.particulars).filter(Boolean)).size;
  const avg = rows.length ? gross / rows.length : 0;
  document.getElementById("insight-grid").innerHTML = [
    ["Gross Sales", money(gross), "All records"],
    ["Taxable Value", money(taxable), "Before GST"],
    ["GST Collected", money(gst), "SGST + CGST + IGST"],
    ["Vouchers", num(rows.length), `${num(customers)} customers`],
    ["Avg Voucher", money(avg), "Gross average"],
  ].map(([label, value, hint]) => `
    <div class="insight-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(hint)}</small>
    </div>
  `).join("");
}

function renderRankList(id, groups) {
  const top = groups.slice(0, 8);
  const max = top[0]?.value || 1;
  document.getElementById(id).innerHTML = top.map(g => `
    <div class="rank-row">
      <div class="rank-main">
        <span>${escapeHtml(g.key)}</span>
        <strong>${money(g.value)}</strong>
      </div>
      <div class="rank-bar"><span style="width:${Math.max(3, (g.value / max) * 100)}%"></span></div>
      <small>${num(g.count)} record${g.count === 1 ? "" : "s"}</small>
    </div>
  `).join("") || `<div class="empty-panel">No data available.</div>`;
}

function renderSaleAggregate(rows) {
  const buckets = [
    { group: "Domestic", type: "Finished Goods", category: "Domestic - Finished Goods" },
    { group: "Domestic", type: "Raw Material", category: "Domestic - Raw Material" },
    { group: "Export", type: "Finished Goods", category: "Export - Finished Goods" },
    { group: "Export", type: "Raw Material", category: "Export - Raw Material" },
  ].map(bucket => {
    const matching = rows.filter(r => r.category === bucket.category);
    return {
      ...bucket,
      count: matching.length,
      taxable: sumBy(matching, "taxable_value"),
      gross: sumBy(matching, "gross_total"),
      gst: matching.reduce((a, r) => a + (+r.sgst_9pct || 0) + (+r.cgst_9pct || 0) + (+r.igst_18pct || 0), 0),
    };
  });

  const totals = buckets.reduce((acc, row) => {
    acc.count += row.count;
    acc.taxable += row.taxable;
    acc.gross += row.gross;
    acc.gst += row.gst;
    return acc;
  }, { count: 0, taxable: 0, gross: 0, gst: 0 });

  document.getElementById("sale-aggregate").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Sale</th>
          <th>Material</th>
          <th class="num">Records</th>
          <th class="num">Taxable</th>
          <th class="num">GST</th>
          <th class="num">Gross</th>
        </tr>
      </thead>
      <tbody>
        ${buckets.map(row => `
          <tr>
            <td>${escapeHtml(row.group)}</td>
            <td>${escapeHtml(row.type)}</td>
            <td class="num">${num(row.count)}</td>
            <td class="num">${money(row.taxable)}</td>
            <td class="num">${money(row.gst)}</td>
            <td class="num strong">${money(row.gross)}</td>
          </tr>
        `).join("")}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2">Total</td>
          <td class="num">${num(totals.count)}</td>
          <td class="num">${money(totals.taxable)}</td>
          <td class="num">${money(totals.gst)}</td>
          <td class="num strong">${money(totals.gross)}</td>
        </tr>
      </tfoot>
    </table>
  `;
}

export function buildHomeTimeline(rangeKey, refDateStr) {
  const cfg = HOME_RANGES[rangeKey] || HOME_RANGES["1y"];
  const ref = new Date(`${refDateStr}T00:00:00`);
  const buckets = [];

  if (cfg.bucket === "day") {
    const fmt = d => d.toLocaleString(undefined, { month: "short", day: "numeric" });
    for (let i = cfg.count - 1; i >= 0; i--) {
      const d = new Date(ref);
      d.setDate(d.getDate() - i);
      const iso = isoDate(d);
      buckets.push({ label: fmt(d), start: iso, end: iso });
    }
  } else if (cfg.bucket === "monthDays") {
    const year = ref.getFullYear();
    const month = ref.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= lastDay; day++) {
      const d = new Date(year, month, day);
      const iso = isoDate(d);
      buckets.push({ label: String(day), start: iso, end: iso });
    }
  } else if (cfg.bucket === "week") {
    const start = new Date(ref);
    start.setDate(start.getDate() - (cfg.count * 7 - 1));
    const fmt = d => d.toLocaleString(undefined, { month: "short", day: "numeric" });
    for (let i = 0; i < cfg.count; i++) {
      const s = new Date(start);
      s.setDate(s.getDate() + i * 7);
      const e = new Date(s);
      e.setDate(e.getDate() + 6);
      const sameMonth = s.getMonth() === e.getMonth();
      buckets.push({
        label: sameMonth ? `${fmt(s)}–${e.getDate()}` : `${fmt(s)}–${fmt(e)}`,
        start: isoDate(s),
        end: isoDate(e),
      });
    }
  } else if (cfg.bucket === "month") {
    const start = new Date(ref.getFullYear(), ref.getMonth() - (cfg.count - 1), 1);
    for (let i = 0; i < cfg.count; i++) {
      const m = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const e = new Date(m.getFullYear(), m.getMonth() + 1, 0);
      buckets.push({
        label: m.toLocaleString(undefined, { month: "short", year: "2-digit" }),
        start: isoDate(m),
        end: isoDate(e),
      });
    }
  } else if (cfg.bucket === "year") {
    const refY = ref.getFullYear();
    for (let i = cfg.count - 1; i >= 0; i--) {
      const y = refY - i;
      buckets.push({ label: String(y), start: `${y}-01-01`, end: `${y}-12-31` });
    }
  }
  return buckets;
}

function tooltipTitle(b) {
  if (!b) return "";
  if (b.start && b.start === b.end) {
    return new Date(`${b.start}T00:00:00`).toLocaleString(undefined, {
      weekday: "short", month: "short", day: "numeric", year: "numeric",
    });
  }
  return b.label || "";
}

function rowsInRange(rows, buckets) {
  if (!buckets.length) return rows;
  const start = buckets[0].start;
  const end = buckets[buckets.length - 1].end;
  return rows.filter(r => r.voucher_date && r.voucher_date >= start && r.voucher_date <= end);
}

function bucketSums(rows, buckets, field = "gross_total") {
  return buckets.map(b => {
    const subset = rows.filter(r => r.voucher_date >= b.start && r.voucher_date <= b.end);
    const value = subset.reduce((a, r) => a + (Number(r[field]) || 0), 0);
    return { label: b.label, value, count: subset.length, start: b.start, end: b.end };
  });
}

function buildLastNDays(refDateStr, count) {
  const ref = new Date(`${refDateStr}T00:00:00`);
  const days = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(ref);
    d.setDate(d.getDate() - i);
    days.push({
      date: isoDate(d),
      label: d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric" }),
    });
  }
  return days;
}

function renderLast7DaysGross(rows, refDate) {
  const days = buildLastNDays(refDate, 7);
  const dayRows = days.map(day => {
    const matching = rows.filter(r => r.voucher_date === day.date);
    return {
      ...day,
      count: matching.length,
      gross: sumBy(matching, "gross_total"),
    };
  });
  const total = dayRows.reduce((a, r) => a + r.gross, 0);
  document.getElementById("last-7-days-range").textContent =
    days.length ? `${days[0].date} → ${days[days.length - 1].date}` : "No range";
  document.getElementById("last-7-days-gross").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Day</th>
          <th>Date</th>
          <th class="num">Invoices</th>
          <th class="num">Gross</th>
        </tr>
      </thead>
      <tbody>
        ${dayRows.map(row => `
          <tr>
            <td>${escapeHtml(row.label)}</td>
            <td>${escapeHtml(row.date)}</td>
            <td class="num">${num(row.count)}</td>
            <td class="num strong">${money(row.gross)}</td>
          </tr>
        `).join("")}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2">Total</td>
          <td class="num">${num(dayRows.reduce((a, r) => a + r.count, 0))}</td>
          <td class="num strong">${money(total)}</td>
        </tr>
      </tfoot>
    </table>
  `;
}

function renderRangeBarSelection() {
  document.querySelectorAll("#home-range-bar .range-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.range === state.homeRange);
  });
}

export function renderHome() {
  const refDate = getReferenceDate(state.rows);
  const buckets = buildHomeTimeline(state.homeRange, refDate);
  const rows = rowsInRange(state.rows, buckets);

  renderRangeBarSelection();
  const cfg = HOME_RANGES[state.homeRange];
  document.getElementById("range-anchor").textContent = state.rows.length
    ? `${cfg.label} · anchored to ${refDate}`
    : "";

  renderTotals(rows);
  renderInsightCards(rows);

  const bucketed = bucketSums(rows, buckets, "gross_total");
  const rangeLabel = buckets.length
    ? `${buckets[0].start} → ${buckets[buckets.length - 1].end}`
    : "No range";
  document.getElementById("trend-range").textContent = rangeLabel;
  document.getElementById("cumulative-range").textContent = rangeLabel;

  if (dailyChart) dailyChart.destroy();
  dailyChart = new Chart(document.getElementById("daily-chart"), {
    type: "bar",
    data: {
      labels: bucketed.map(b => b.label),
      datasets: [{
        data: bucketed.map(b => b.value),
        backgroundColor: ACCENT,
        borderRadius: 6,
        maxBarThickness: 60,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ctx => tooltipTitle(bucketed[ctx[0].dataIndex]),
            label: c => `${money(c.parsed.y)}  ·  ${bucketed[c.dataIndex].count} voucher${bucketed[c.dataIndex].count === 1 ? "" : "s"}`,
          },
        },
      },
      scales: {
        y: { ticks: { callback: v => money(v) }, beginAtZero: true },
        x: { grid: { display: false } },
      },
    },
  });

  let cum = 0;
  const cumulative = bucketed.map(b => { cum += b.value; return cum; });
  if (cumulativeChart) cumulativeChart.destroy();
  cumulativeChart = new Chart(document.getElementById("cumulative-chart"), {
    type: "line",
    data: {
      labels: bucketed.map(b => b.label),
      datasets: [{
        data: cumulative,
        borderColor: "#059669",
        backgroundColor: "rgba(5, 150, 105, 0.12)",
        fill: true,
        tension: 0.25,
        pointRadius: 3,
        pointBackgroundColor: "#059669",
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ctx => tooltipTitle(bucketed[ctx[0].dataIndex]),
            label: c => `Cumulative ${money(c.parsed.y)}`,
          },
        },
      },
      scales: {
        y: { ticks: { callback: v => money(v) }, beginAtZero: true },
        x: { grid: { display: false } },
      },
    },
  });

  const byType = groupRows(rows, r => r.category || "Other");
  if (saleTypeChart) saleTypeChart.destroy();
  saleTypeChart = new Chart(document.getElementById("sale-type-chart"), {
    type: "doughnut",
    data: {
      labels: byType.map(g => g.key),
      datasets: [{
        data: byType.map(g => g.value),
        backgroundColor: ["#4f46e5", "#059669", "#d97706", "#dc2626", "#0891b2", "#7c3aed", "#64748b"],
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => `${c.label}: ${money(c.parsed)}` } } },
    },
  });

  renderRankList("location-insights", groupRows(rows, r => locationLabel(r.location) || "Unknown"));
  renderRankList("customer-insights", groupRows(rows, r => r.particulars || "Unknown"));
  renderSaleAggregate(rows);
  renderLast7DaysGross(state.rows, refDate);
}

export function wireHome() {
  document.querySelectorAll("#home-range-bar .range-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const r = btn.dataset.range;
      if (!HOME_RANGES[r] || r === state.homeRange) return;
      state.homeRange = r;
      renderHome();
    });
  });
}
