import { money, num, pct, escapeHtml } from "../../format.js";
import { ST } from "./state.js";
import { buildPersonGroups, shortName } from "./data.js";
import { renderKpiStrip, renderPersonCards, renderPerformanceCards } from "./cards.js";
import { renderSalesCharts, renderPersonalCharts } from "./charts.js";

export function renderCrumbs() {
  const parts = [`<button class="crumb-link" data-crumb="l0">Sales Team Insights</button>`];
  if (ST.view === "person" && ST.selection.person) {
    parts.push(`<span class="crumb-sep">›</span>`);
    parts.push(`<span class="crumb-current">${escapeHtml(ST.selection.person)}</span>`);
  }
  document.getElementById("sales-team-crumbs").innerHTML = parts.join("");
}

export function renderL0(rows) {
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

export function renderPersonDetail(rows) {
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
