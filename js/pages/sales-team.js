import { state } from "../state.js";
import { money, num, escapeHtml, sumBy, debounce, monthLabel } from "../format.js";
import { uniqueMonths } from "../rows.js";
import { uploadSalespersonFile } from "../api.js";

// Per-page state. Lives in this module (not global state) since nothing else needs it.
const ST = {
  view: "l0",                  // "l0" | "l1" | "l2"
  selection: { person: null, customer: null },
  filters: {
    saleGroup: "",             // "" | "domestic" | "export"
    material: "",              // "" | "fg" | "rm"
    month: "",                 // "" | "YYYY-MM"
    dateFrom: "",
    dateTo: "",
    q: "",
  },
};

const UNASSIGNED = "Unassigned";

function isDomestic(cat) { return /^domestic/i.test(cat || ""); }
function isExport(cat)   { return /^export/i.test(cat || ""); }
function isFG(cat)       { return /finished goods/i.test(cat || ""); }
function isRM(cat)       { return /raw material/i.test(cat || ""); }

function rowGst(r) {
  return (+r.sgst_9pct || 0) + (+r.cgst_9pct || 0) + (+r.igst_18pct || 0);
}

function applyFilters(rows) {
  const { saleGroup, material, month, dateFrom, dateTo, q } = ST.filters;
  const needle = q.trim().toLowerCase();
  return rows.filter(r => {
    if (saleGroup === "domestic" && !isDomestic(r.category)) return false;
    if (saleGroup === "export"   && !isExport(r.category))   return false;
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

function renderKpiStrip(rows, extra = {}) {
  const a = aggregate(rows);
  const cards = [
    ["Gross Sales", money(a.gross), "After GST"],
    ["Taxable Value", money(a.taxable), "Before GST"],
    ["GST", money(a.gst), "SGST + CGST + IGST"],
    ["Quantity", num(a.qty), "Units"],
    ["Invoices", num(a.invoices), extra.invoicesHint || ""],
  ];
  if (extra.customers !== undefined) {
    cards.push(["Customers", num(extra.customers), ""]);
  }
  document.getElementById("st-kpi-strip").innerHTML = cards.map(([label, value, hint]) => `
    <div class="insight-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(hint)}</small>
    </div>
  `).join("");
}

function renderCrumbs() {
  const parts = [`<button class="crumb-link" data-crumb="l0">Sales Team</button>`];
  if (ST.view !== "l0" && ST.selection.person) {
    parts.push(`<span class="crumb-sep">›</span>`);
    parts.push(`<button class="crumb-link" data-crumb="l1">${escapeHtml(ST.selection.person)}</button>`);
  }
  if (ST.view === "l2" && ST.selection.customer) {
    parts.push(`<span class="crumb-sep">›</span>`);
    parts.push(`<span class="crumb-current">${escapeHtml(ST.selection.customer)}</span>`);
  }
  document.getElementById("sales-team-crumbs").innerHTML = parts.join("");
}

function renderL0(rows) {
  document.getElementById("st-panel-title").textContent = "Salespersons";

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

  const groups = [...byPerson.values()].map(g => ({
    person: g.person,
    customers: g.customers.size,
    ...aggregate(g.rows),
  })).sort((a, b) => b.gross - a.gross);

  document.getElementById("st-panel-count").textContent =
    `${num(groups.length)} salesperson${groups.length === 1 ? "" : "s"}`;

  document.getElementById("st-table").innerHTML = `
    <thead>
      <tr>
        <th>Salesperson</th>
        <th class="num">Customers</th>
        <th class="num">Invoices</th>
        <th class="num">Qty</th>
        <th class="num">Taxable</th>
        <th class="num">GST</th>
        <th class="num">Gross</th>
      </tr>
    </thead>
    <tbody>
      ${groups.length ? groups.map(g => `
        <tr class="row-clickable" data-person="${escapeHtml(g.person)}">
          <td><strong>${escapeHtml(g.person)}</strong></td>
          <td class="num">${num(g.customers)}</td>
          <td class="num">${num(g.invoices)}</td>
          <td class="num">${num(g.qty)}</td>
          <td class="num">${money(g.taxable)}</td>
          <td class="num">${money(g.gst)}</td>
          <td class="num strong">${money(g.gross)}</td>
        </tr>
      `).join("") : `<tr><td colspan="7" class="txn-empty">No data for the current filters.</td></tr>`}
    </tbody>
  `;

  renderKpiStrip(rows, { customers: byPerson.size });
}

function renderL1(rows) {
  const person = ST.selection.person;
  document.getElementById("st-panel-title").textContent = `Customers · ${person}`;

  const scoped = rows.filter(r => (r.sales_person || UNASSIGNED) === person);

  const byCustomer = new Map();
  scoped.forEach(r => {
    const name = r.particulars || "(no name)";
    const bucket = byCustomer.get(name) || { customer: name, rows: [] };
    bucket.rows.push(r);
    byCustomer.set(name, bucket);
  });

  const groups = [...byCustomer.values()].map(g => ({
    customer: g.customer,
    ...aggregate(g.rows),
  })).sort((a, b) => b.gross - a.gross);

  document.getElementById("st-panel-count").textContent =
    `${num(groups.length)} customer${groups.length === 1 ? "" : "s"}`;

  document.getElementById("st-table").innerHTML = `
    <thead>
      <tr>
        <th>Customer</th>
        <th class="num">Invoices</th>
        <th class="num">Qty</th>
        <th class="num">Taxable</th>
        <th class="num">GST</th>
        <th class="num">Gross</th>
      </tr>
    </thead>
    <tbody>
      ${groups.length ? groups.map(g => `
        <tr class="row-clickable" data-customer="${escapeHtml(g.customer)}">
          <td>${escapeHtml(g.customer)}</td>
          <td class="num">${num(g.invoices)}</td>
          <td class="num">${num(g.qty)}</td>
          <td class="num">${money(g.taxable)}</td>
          <td class="num">${money(g.gst)}</td>
          <td class="num strong">${money(g.gross)}</td>
        </tr>
      `).join("") : `<tr><td colspan="6" class="txn-empty">No customers for the current filters.</td></tr>`}
    </tbody>
  `;

  renderKpiStrip(scoped, { customers: byCustomer.size });
}

function renderL2(rows) {
  const { person, customer } = ST.selection;
  document.getElementById("st-panel-title").textContent = `Invoices · ${customer}`;

  const scoped = rows
    .filter(r => (r.sales_person || UNASSIGNED) === person && (r.particulars || "") === customer)
    .sort((a, b) => (b.voucher_date || "").localeCompare(a.voucher_date || ""));

  document.getElementById("st-panel-count").textContent =
    `${num(scoped.length)} invoice${scoped.length === 1 ? "" : "s"}`;

  document.getElementById("st-table").innerHTML = `
    <thead>
      <tr>
        <th>Date</th>
        <th>Voucher No.</th>
        <th>Category</th>
        <th class="num">Qty</th>
        <th class="num">Taxable</th>
        <th class="num">GST</th>
        <th class="num">Gross</th>
      </tr>
    </thead>
    <tbody>
      ${scoped.length ? scoped.map(r => `
        <tr>
          <td>${escapeHtml(r.voucher_date || "")}</td>
          <td>${escapeHtml(r.voucher_no || "")}</td>
          <td>${escapeHtml(r.category || "")}</td>
          <td class="num">${num(+r.quantity || 0)}</td>
          <td class="num">${money(+r.taxable_value || 0)}</td>
          <td class="num">${money(rowGst(r))}</td>
          <td class="num strong">${money(+r.gross_total || 0)}</td>
        </tr>
      `).join("") : `<tr><td colspan="7" class="txn-empty">No invoices for the current filters.</td></tr>`}
    </tbody>
  `;

  renderKpiStrip(scoped);
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
  if (ST.view === "l0") renderL0(filtered);
  else if (ST.view === "l1") renderL1(filtered);
  else renderL2(filtered);
}

function goTo(view, selection = {}) {
  ST.view = view;
  ST.selection = { ...ST.selection, ...selection };
  if (view === "l0") ST.selection = { person: null, customer: null };
  if (view === "l1") ST.selection.customer = null;
  renderSalesTeam();
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
    document.getElementById("st-sale-group").value = "";
    document.getElementById("st-material").value = "";
    document.getElementById("st-month").value = "";
    document.getElementById("st-date-from").value = "";
    document.getElementById("st-date-to").value = "";
    document.getElementById("st-q").value = "";
    renderSalesTeam();
  });

  // Drill in / out
  document.getElementById("st-table").addEventListener("click", e => {
    const tr = e.target.closest("tr.row-clickable");
    if (!tr) return;
    if (ST.view === "l0" && tr.dataset.person) {
      goTo("l1", { person: tr.dataset.person });
    } else if (ST.view === "l1" && tr.dataset.customer) {
      goTo("l2", { customer: tr.dataset.customer });
    }
  });

  document.getElementById("sales-team-crumbs").addEventListener("click", e => {
    const b = e.target.closest("button.crumb-link");
    if (!b) return;
    goTo(b.dataset.crumb);
  });

  // Upload mapping
  bind("sp-upload-btn", "click", () => document.getElementById("sp-upload-input").click());
  bind("sp-upload-input", "change", e => {
    const f = e.target.files && e.target.files[0];
    if (f) uploadSalespersonFile(f);
    e.target.value = "";
  });
}
