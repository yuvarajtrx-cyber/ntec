import { state } from "../state.js";
import { money, num, escapeHtml, sumBy, debounce, monthLabel } from "../format.js";
import { uniqueMonths, uniqueSorted } from "../rows.js";
import { filtersFromControls, summaryFromCards, tableSectionFromDom, wireExportActions } from "../export.js";

const CU = {
  view: "l0",                  // "l0" | "l1"
  selection: { customer: null },
  filters: {
    saleGroup: "",
    material: "",
    person: "",
    month: "",
    dateFrom: "",
    dateTo: "",
    q: "",
    grossMin: 0,
    grossMax: Infinity,
  },
};

let _dataGrossMax = 0;  // largest per-customer gross in the currently-filtered data

const UNASSIGNED = "Unassigned";

function isDomestic(cat) { return /^domestic/i.test(cat || ""); }
function isExport(cat)   { return /^export/i.test(cat || ""); }
function isFG(cat)       { return /finished goods/i.test(cat || ""); }
function isRM(cat)       { return /raw material/i.test(cat || ""); }
function isOther(cat)    { return !isDomestic(cat) && !isExport(cat); }

function rowGst(r) {
  return (+r.sgst_9pct || 0) + (+r.cgst_9pct || 0) + (+r.igst_18pct || 0);
}

function applyFilters(rows) {
  const { saleGroup, material, person, month, dateFrom, dateTo, q } = CU.filters;
  const needle = q.trim().toLowerCase();
  return rows.filter(r => {
    if (saleGroup === "domestic" && !isDomestic(r.category)) return false;
    if (saleGroup === "export"   && !isExport(r.category))   return false;
    if (saleGroup === "other"    && !isOther(r.category))    return false;
    if (material === "fg" && !isFG(r.category)) return false;
    if (material === "rm" && !isRM(r.category)) return false;
    if (person && (r.sales_person || UNASSIGNED) !== person) return false;
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

function bucketGross(rows, predicate) {
  return rows.reduce((a, r) => predicate(r.category) ? a + (+r.gross_total || 0) : a, 0);
}

function renderKpiStrip(rows, extra = {}) {
  const a = aggregate(rows);
  const cards = [
    ["Gross Sales", money(a.gross), "After GST"],
    ["Taxable Value", money(a.taxable), "Before GST"],
    ["GST", money(a.gst), "SGST + CGST + IGST"],
    ["Invoices", num(a.invoices), ""],
  ];
  if (extra.customers !== undefined) {
    cards.push(["Customers", num(extra.customers), ""]);
  }
  document.getElementById("cu-kpi-strip").innerHTML = cards.map(([label, value, hint]) => `
    <div class="insight-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(hint)}</small>
    </div>
  `).join("");
}

function renderCrumbs() {
  const parts = [`<button class="crumb-link" data-crumb="l0">Customers</button>`];
  if (CU.view === "l1" && CU.selection.customer) {
    parts.push(`<span class="crumb-sep">›</span>`);
    parts.push(`<span class="crumb-current">${escapeHtml(CU.selection.customer)}</span>`);
  }
  document.getElementById("customers-crumbs").innerHTML = parts.join("");
}

function renderL0(rows) {
  document.getElementById("cu-panel-title").textContent = "All Customers";

  const byCustomer = new Map();
  rows.forEach(r => {
    const name = r.particulars || "(no name)";
    const bucket = byCustomer.get(name) || { customer: name, rows: [], persons: new Set() };
    bucket.rows.push(r);
    bucket.persons.add(r.sales_person || UNASSIGNED);
    byCustomer.set(name, bucket);
  });

  const groupsAll = [...byCustomer.values()].map(g => {
    const agg = aggregate(g.rows);
    return {
      customer: g.customer,
      person: [...g.persons].sort().join(", "),
      domFg: bucketGross(g.rows, c => isDomestic(c) && isFG(c)),
      domRm: bucketGross(g.rows, c => isDomestic(c) && isRM(c)),
      expFg: bucketGross(g.rows, c => isExport(c)   && isFG(c)),
      expRm: bucketGross(g.rows, c => isExport(c)   && isRM(c)),
      other: bucketGross(g.rows, c => isOther(c)),
      ...agg,
    };
  }).sort((a, b) => b.gross - a.gross);

  // Slider scale is the current pre-gross-filter max, so the handles always
  // span something visible even after other filters narrow the dataset.
  _dataGrossMax = groupsAll.length ? Math.max(...groupsAll.map(g => g.gross)) : 0;
  updateGrossSliderUi();

  const grossMin = CU.filters.grossMin || 0;
  const grossMax = Number.isFinite(CU.filters.grossMax) ? CU.filters.grossMax : Infinity;
  const groups = groupsAll.filter(g => g.gross >= grossMin && g.gross <= grossMax);

  document.getElementById("cu-panel-count").textContent =
    groups.length === groupsAll.length
      ? `${num(groups.length)} customer${groups.length === 1 ? "" : "s"}`
      : `${num(groups.length)} of ${num(groupsAll.length)} customers`;

  document.getElementById("cu-table").innerHTML = `
    <thead>
      <tr>
        <th>Customer</th>
        <th>Salesperson</th>
        <th class="num">Invoices</th>
        <th class="num">Dom · FG</th>
        <th class="num">Dom · RM</th>
        <th class="num">Exp · FG</th>
        <th class="num">Exp · RM</th>
        <th class="num">Other</th>
        <th class="num">Taxable</th>
        <th class="num">GST</th>
        <th class="num">Gross</th>
      </tr>
    </thead>
    <tbody>
      ${groups.length ? groups.map(g => `
        <tr class="row-clickable" data-customer="${escapeHtml(g.customer)}">
          <td>${escapeHtml(g.customer)}</td>
          <td>${escapeHtml(g.person)}</td>
          <td class="num">${num(g.invoices)}</td>
          <td class="num">${g.domFg ? money(g.domFg) : "—"}</td>
          <td class="num">${g.domRm ? money(g.domRm) : "—"}</td>
          <td class="num">${g.expFg ? money(g.expFg) : "—"}</td>
          <td class="num">${g.expRm ? money(g.expRm) : "—"}</td>
          <td class="num">${g.other ? money(g.other) : "—"}</td>
          <td class="num">${money(g.taxable)}</td>
          <td class="num">${money(g.gst)}</td>
          <td class="num strong">${money(g.gross)}</td>
        </tr>
      `).join("") : `<tr><td colspan="11" class="txn-empty">No customers for the current filters.</td></tr>`}
    </tbody>
  `;

  renderKpiStrip(rows, { customers: byCustomer.size });
}

function renderL1(rows) {
  const customer = CU.selection.customer;
  document.getElementById("cu-panel-title").textContent = `Invoices · ${customer}`;

  const scoped = rows
    .filter(r => (r.particulars || "") === customer)
    .sort((a, b) => (b.voucher_date || "").localeCompare(a.voucher_date || ""));

  document.getElementById("cu-panel-count").textContent =
    `${num(scoped.length)} invoice${scoped.length === 1 ? "" : "s"}`;

  document.getElementById("cu-table").innerHTML = `
    <thead>
      <tr>
        <th>Date</th>
        <th>Voucher No.</th>
        <th>Salesperson</th>
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
          <td>${escapeHtml(r.sales_person || UNASSIGNED)}</td>
          <td>${escapeHtml(r.category || "")}</td>
          <td class="num">${num(+r.quantity || 0)}</td>
          <td class="num">${money(+r.taxable_value || 0)}</td>
          <td class="num">${money(rowGst(r))}</td>
          <td class="num strong">${money(+r.gross_total || 0)}</td>
        </tr>
      `).join("") : `<tr><td colspan="8" class="txn-empty">No invoices for the current filters.</td></tr>`}
    </tbody>
  `;

  renderKpiStrip(scoped);
}

function updateGrossSliderUi() {
  const minSlider = document.getElementById("cu-gross-min");
  const maxSlider = document.getElementById("cu-gross-max");
  const fill = document.getElementById("cu-gross-fill");
  const minLabel = document.getElementById("cu-gross-min-label");
  const maxLabel = document.getElementById("cu-gross-max-label");
  if (!minSlider || !maxSlider) return;

  const dataMax = Math.max(_dataGrossMax, 1);
  // ~200 steps across the range, rounded to a clean power of 10.
  const rawStep = dataMax / 200;
  const step = Math.max(1, Math.pow(10, Math.floor(Math.log10(rawStep) || 0)));

  minSlider.min = 0;
  minSlider.max = dataMax;
  minSlider.step = step;
  maxSlider.min = 0;
  maxSlider.max = dataMax;
  maxSlider.step = step;

  // Clamp stored filter to current data range.
  let minV = Math.max(0, Math.min(CU.filters.grossMin, dataMax));
  let maxV = Number.isFinite(CU.filters.grossMax)
    ? Math.max(0, Math.min(CU.filters.grossMax, dataMax))
    : dataMax;
  if (minV > maxV) [minV, maxV] = [maxV, minV];
  minSlider.value = minV;
  maxSlider.value = maxV;

  const leftPct = dataMax ? (minV / dataMax) * 100 : 0;
  const rightPct = dataMax ? (maxV / dataMax) * 100 : 100;
  fill.style.left = `${leftPct}%`;
  fill.style.width = `${Math.max(0, rightPct - leftPct)}%`;

  minLabel.textContent = money(minV);
  maxLabel.textContent = maxV >= _dataGrossMax ? `${money(_dataGrossMax)}+` : money(maxV);
}

function refreshSelectOptions() {
  const monthSel = document.getElementById("cu-month");
  if (monthSel) {
    const cur = monthSel.value;
    const months = uniqueMonths(state.rows);
    monthSel.innerHTML = `<option value="">All</option>` + months.map(m =>
      `<option value="${escapeHtml(m)}">${escapeHtml(monthLabel(m))}</option>`
    ).join("");
    if (months.includes(cur)) monthSel.value = cur;
  }
  const personSel = document.getElementById("cu-salesperson");
  if (personSel) {
    const cur = personSel.value;
    const persons = uniqueSorted(state.rows, "sales_person");
    personSel.innerHTML = `<option value="">All</option>` + persons.map(p =>
      `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`
    ).join("");
    if (persons.includes(cur)) personSel.value = cur;
  }
}

function refreshMetaLine() {
  document.getElementById("customers-meta-source").textContent =
    state.rows.length ? "Sales register" : "No data loaded";
  document.getElementById("customers-meta-count").textContent =
    state.rows.length ? `${num(state.rows.length)} invoice rows` : "—";
}

export function renderCustomers() {
  refreshMetaLine();
  refreshSelectOptions();
  renderCrumbs();
  const sliderLabel = document.querySelector("#page-customers .range-label");
  if (sliderLabel) sliderLabel.style.display = CU.view === "l0" ? "" : "none";
  const filtered = applyFilters(state.rows);
  if (CU.view === "l0") renderL0(filtered);
  else renderL1(filtered);
}

function goTo(view, selection = {}) {
  CU.view = view;
  CU.selection = { ...CU.selection, ...selection };
  if (view === "l0") CU.selection = { customer: null };
  renderCustomers();
}

export function wireCustomers() {
  wireExportActions({
    excelId: "customers-export-excel",
    pdfId: "customers-export-pdf",
    buildPayload: () => ({
      page: "customers",
      title: "NTEC Customers Report",
      filters: [
        { label: "View", value: CU.view === "l0" ? "All Customers" : CU.selection.customer || "Customer Detail" },
        ...filtersFromControls([
          ["Sale Type", "cu-sale-group"],
          ["Material", "cu-material"],
          ["Salesperson", "cu-salesperson"],
          ["Month", "cu-month"],
          ["From", "cu-date-from"],
          ["To", "cu-date-to"],
          ["Search", "cu-q"],
        ]),
      ],
      summary: summaryFromCards("#cu-kpi-strip"),
      sections: [tableSectionFromDom(document.getElementById("cu-panel-title").textContent || "Customers", "cu-table")],
    }),
  });
  const bind = (id, evt, fn) => document.getElementById(id).addEventListener(evt, fn);

  bind("cu-sale-group",  "change", e => { CU.filters.saleGroup = e.target.value; renderCustomers(); });
  bind("cu-material",    "change", e => { CU.filters.material  = e.target.value; renderCustomers(); });
  bind("cu-salesperson", "change", e => { CU.filters.person    = e.target.value; renderCustomers(); });
  bind("cu-month",       "change", e => { CU.filters.month     = e.target.value; renderCustomers(); });
  bind("cu-date-from",   "change", e => { CU.filters.dateFrom  = e.target.value; renderCustomers(); });
  bind("cu-date-to",     "change", e => { CU.filters.dateTo    = e.target.value; renderCustomers(); });
  bind("cu-q",           "input",  debounce(e => { CU.filters.q = e.target.value; renderCustomers(); }, 200));

  const minSlider = document.getElementById("cu-gross-min");
  const maxSlider = document.getElementById("cu-gross-max");
  const onGrossSlide = () => {
    let lo = +minSlider.value;
    let hi = +maxSlider.value;
    if (lo > hi) [lo, hi] = [hi, lo];
    CU.filters.grossMin = lo;
    CU.filters.grossMax = hi >= _dataGrossMax ? Infinity : hi;
    renderCustomers();
  };
  minSlider.addEventListener("input", onGrossSlide);
  maxSlider.addEventListener("input", onGrossSlide);

  bind("cu-reset", "click", () => {
    CU.filters = {
      saleGroup: "", material: "", person: "", month: "",
      dateFrom: "", dateTo: "", q: "",
      grossMin: 0, grossMax: Infinity,
    };
    ["cu-sale-group", "cu-material", "cu-salesperson", "cu-month", "cu-date-from", "cu-date-to", "cu-q"]
      .forEach(id => { document.getElementById(id).value = ""; });
    renderCustomers();
  });

  document.getElementById("cu-table").addEventListener("click", e => {
    const tr = e.target.closest("tr.row-clickable");
    if (!tr) return;
    if (CU.view === "l0" && tr.dataset.customer) {
      goTo("l1", { customer: tr.dataset.customer });
    }
  });

  document.getElementById("customers-crumbs").addEventListener("click", e => {
    const b = e.target.closest("button.crumb-link");
    if (!b) return;
    goTo(b.dataset.crumb);
  });
}
