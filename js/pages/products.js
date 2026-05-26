import { state } from "../state.js";
import { ACCENT, CHART_PALETTE, PRODUCT_CHART_MEASURES } from "../constants.js";
import { money, num, escapeHtml, monthLabel, debounce } from "../format.js";
import { flattenLineItems, productKey } from "../product-utils.js";
import { saleTypeMatches, saleTypeOptions } from "../sale-type.js";

let productsChart = null;
let PRODUCTS_PAGE = 1;
let DRILLDOWN_PRODUCT = null;

function getProductState() {
  return {
    q: document.getElementById("products-search").value.trim().toLowerCase(),
    sort: document.getElementById("products-sort").value,
    category: document.getElementById("products-filter-category").value,
    market: document.getElementById("products-filter-market").value,
    material: document.getElementById("products-filter-material").value,
    salesperson: document.getElementById("products-filter-salesperson").value,
    month: document.getElementById("products-filter-month").value,
    customer: document.getElementById("products-filter-customer").value,
  };
}

function lineMarket(li) {
  const cat = String(li.category || "").toLowerCase();
  if (cat.startsWith("domestic")) return "domestic";
  if (cat.startsWith("export")) return "export";
  return "other";
}

function lineMaterial(li) {
  const cat = String(li.category || "");
  if (/finished goods/i.test(cat)) return "fg";
  if (/raw material/i.test(cat)) return "rm";
  return "other";
}

function productLineMatches(li, st) {
  if (st.category && li.category !== st.category) return false;
  if (st.market && lineMarket(li) !== st.market) return false;
  if (st.material && lineMaterial(li) !== st.material) return false;
  if (st.salesperson && (li.sales_person || "Unassigned") !== st.salesperson) return false;
  if (st.month && li.month !== st.month) return false;
  if (st.customer && li.customer !== st.customer) return false;
  if (st.q && !li.product.toLowerCase().includes(st.q)) return false;
  return true;
}

function aggregateProducts(lineItems, st) {
  const filtered = lineItems.filter(li => {
    return productLineMatches(li, st);
  });

  // Group by case/whitespace-insensitive key. The first display name wins,
  // so subsequent variants ("SEALKING…" / "Sealking…") fold into the same row.
  const map = new Map();
  filtered.forEach(li => {
    const key = li.productKey || li.product.toLowerCase();
    const g = map.get(key) || {
      product: li.product,
      quantity: 0,
      value: 0,
      invoices: new Set(),
      customers: new Set(),
      lastDate: null,
    };
    g.quantity += li.quantity;
    g.value += li.value;
    if (li.voucher_no) g.invoices.add(li.voucher_no);
    if (li.customer) g.customers.add(li.customer);
    if (li.voucher_date && (!g.lastDate || li.voucher_date > g.lastDate)) {
      g.lastDate = li.voucher_date;
    }
    map.set(key, g);
  });

  return [...map.values()].map(g => ({
    product: g.product,
    quantity: g.quantity,
    value: g.value,
    avgRate: g.quantity > 0 ? g.value / g.quantity : 0,
    invoices: g.invoices.size,
    customers: g.customers.size,
    lastDate: g.lastDate,
  }));
}

function sortProducts(groups, sortKey) {
  const cmp = {
    "value-desc": (a, b) => b.value - a.value,
    "value-asc": (a, b) => a.value - b.value,
    "qty-desc": (a, b) => b.quantity - a.quantity,
    "qty-asc": (a, b) => a.quantity - b.quantity,
    "invoices-desc": (a, b) => b.invoices - a.invoices,
    "name-asc": (a, b) => a.product.localeCompare(b.product),
    "name-desc": (a, b) => b.product.localeCompare(a.product),
  }[sortKey] || ((a, b) => b.value - a.value);
  return [...groups].sort(cmp);
}

function renderProductTotals(groups, lineItems) {
  const value = groups.reduce((a, g) => a + g.value, 0);
  const qty = groups.reduce((a, g) => a + g.quantity, 0);
  document.getElementById("products-totals").innerHTML = `
    <div><span class="t-label">Products</span><span class="t-value">${num(groups.length)}</span></div>
    <div><span class="t-label">Lines</span><span class="t-value">${num(lineItems.length)}</span></div>
    <div><span class="t-label">Quantity</span><span class="t-value">${num(qty)}</span></div>
    <div><span class="t-label">Value</span><span class="t-value">${money(value)}</span></div>
  `;
}

function renderProductInsights(groups, filteredLines) {
  const value = groups.reduce((a, g) => a + g.value, 0);
  const qty = groups.reduce((a, g) => a + g.quantity, 0);
  const top = groups.slice().sort((a, b) => b.value - a.value)[0];
  const topName = top ? (top.product.length > 28 ? top.product.slice(0, 26) + "…" : top.product) : "—";
  const avgValue = groups.length ? value / groups.length : 0;
  document.getElementById("products-insight-grid").innerHTML = [
    ["Products", num(groups.length), `${num(filteredLines.length)} line${filteredLines.length === 1 ? "" : "s"}`],
    ["Total Quantity", num(qty), "Across all products"],
    ["Total Value", money(value), "Sum of line values"],
    ["Avg per Product", money(avgValue), "Value / products"],
    ["Top Product", topName, top ? money(top.value) : "—"],
  ].map(([label, value, hint]) => `
    <div class="insight-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(hint)}</small>
    </div>
  `).join("");
}

function getProductChartState() {
  return {
    type: document.getElementById("products-chart-type").value,
    measure: document.getElementById("products-chart-measure").value,
    topN: document.getElementById("products-chart-topn").value,
  };
}

function renderProductChart(groups) {
  const cstate = getProductChartState();
  const measure = PRODUCT_CHART_MEASURES[cstate.measure] || PRODUCT_CHART_MEASURES.value;
  const sorted = groups.slice().sort((a, b) => measure.get(b) - measure.get(a));
  const isBarH = cstate.type === "bar-h";
  const isBarV = cstate.type === "bar-v";
  const isLine = cstate.type === "line";
  const isDoughnut = cstate.type === "doughnut";
  const chartType = isLine ? "line" : isDoughnut ? "doughnut" : "bar";

  // Doughnut is unreadable beyond ~30 slices regardless of user choice — auto-cap with "Other".
  const requestedLimit = cstate.topN === "all" ? sorted.length : Math.max(1, Number(cstate.topN) || 10);
  const effectiveLimit = isDoughnut ? Math.min(requestedLimit, 30) : requestedLimit;
  const shown = sorted.slice(0, effectiveLimit);
  const remainder = sorted.slice(effectiveLimit);
  const otherValue = remainder.reduce((a, g) => a + measure.get(g), 0);

  // Title — call out auto-cap on doughnut so the user understands.
  let suffix;
  if (cstate.topN === "all" && effectiveLimit < sorted.length) {
    suffix = ` (top ${effectiveLimit} of ${sorted.length} + Other)`;
  } else if (cstate.topN === "all") {
    suffix = ` (all ${sorted.length})`;
  } else {
    suffix = ` (top ${Math.min(effectiveLimit, sorted.length)} of ${sorted.length})`;
  }
  document.getElementById("products-chart-title").textContent = `${measure.label} by Product${suffix}`;

  const labelFor = name => (name.length > 36 ? name.slice(0, 34) + "…" : name);
  let chartLabels = shown.map(g => labelFor(g.product));
  let chartValues = shown.map(g => measure.get(g));
  if (isDoughnut && otherValue > 0) {
    chartLabels = [...chartLabels, "Other"];
    chartValues = [...chartValues, otherValue];
  }

  // Dynamic canvas height: give horizontal bars ~22px each so labels are legible.
  const box = document.getElementById("products-chart").closest(".products-chart-box");
  if (isBarH) {
    box.style.height = `${Math.max(380, chartLabels.length * 22 + 40)}px`;
  } else if (isDoughnut) {
    box.style.height = "440px";
  } else {
    box.style.height = "380px";
  }

  const colors = chartLabels.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]);

  if (productsChart) productsChart.destroy();
  productsChart = new Chart(document.getElementById("products-chart"), {
    type: chartType,
    data: {
      labels: chartLabels,
      datasets: [{
        label: measure.label,
        data: chartValues,
        backgroundColor: isLine ? "rgba(79, 70, 229, 0.15)" : colors,
        borderColor: isLine ? ACCENT : undefined,
        borderRadius: isBarH || isBarV ? 4 : 0,
        fill: isLine,
        tension: isLine ? 0.25 : 0,
        pointRadius: isLine ? 3 : 0,
        pointBackgroundColor: ACCENT,
      }],
    },
    options: {
      indexAxis: isBarH ? "y" : "x",
      maintainAspectRatio: false,
      animation: chartLabels.length > 100 ? false : undefined,
      plugins: {
        legend: {
          display: isDoughnut && chartLabels.length <= 25,
          position: "bottom",
          labels: { boxWidth: 10, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            title: ctx => {
              const i = ctx[0].dataIndex;
              return shown[i]?.product || ctx[0].label || "";
            },
            label: c => {
              const v = isDoughnut ? c.parsed : (isBarH ? c.parsed.x : c.parsed.y);
              return `${measure.label}: ${measure.format(v)}`;
            },
          },
        },
      },
      scales: isDoughnut ? {} : {
        x: {
          ticks: isBarH
            ? { callback: v => measure.format(v) }
            : {
                autoSkip: true,
                autoSkipPadding: 8,
                maxRotation: 60,
                minRotation: chartLabels.length > 20 ? 45 : 0,
                font: { size: 10.5 },
              },
          grid: { display: !isBarH },
        },
        y: {
          ticks: isBarH
            ? { autoSkip: false, font: { size: 11 } }
            : { callback: v => measure.format(v) },
          beginAtZero: true,
        },
      },
    },
  });
}

function getProductsPageSize() {
  const v = document.getElementById("products-page-size").value;
  return v === "all" ? Infinity : (Number(v) || 25);
}

function renderProductsTable(groups) {
  const tbody = document.querySelector("#products-table tbody");
  const pageSize = getProductsPageSize();
  const totalPages = pageSize === Infinity ? 1 : Math.max(1, Math.ceil(groups.length / pageSize));
  if (PRODUCTS_PAGE > totalPages) PRODUCTS_PAGE = totalPages;
  if (PRODUCTS_PAGE < 1) PRODUCTS_PAGE = 1;

  const prev = document.getElementById("products-page-prev");
  const next = document.getElementById("products-page-next");
  prev.disabled = PRODUCTS_PAGE <= 1 || groups.length === 0;
  next.disabled = PRODUCTS_PAGE >= totalPages || groups.length === 0;
  document.getElementById("products-page-status").textContent = `Page ${PRODUCTS_PAGE} of ${totalPages}`;

  if (!groups.length) {
    document.getElementById("products-count").textContent = "0 products";
    tbody.innerHTML = `<tr><td colspan="7" class="txn-empty">No products match your filters.</td></tr>`;
    return;
  }

  const start = pageSize === Infinity ? 0 : (PRODUCTS_PAGE - 1) * pageSize;
  const end = pageSize === Infinity ? groups.length : Math.min(groups.length, start + pageSize);
  const pageRows = groups.slice(start, end);
  document.getElementById("products-count").textContent =
    pageSize === Infinity
      ? `${num(groups.length)} product${groups.length === 1 ? "" : "s"}`
      : `${num(start + 1)}-${num(end)} of ${num(groups.length)} product${groups.length === 1 ? "" : "s"}`;

  tbody.innerHTML = pageRows.map(g => `
    <tr class="row-clickable" data-product="${escapeHtml(g.product)}">
      <td class="customer" title="${escapeHtml(g.product)}">${escapeHtml(g.product)}</td>
      <td class="num">${num(g.quantity)}</td>
      <td class="num">${g.avgRate ? money(g.avgRate, true) : "—"}</td>
      <td class="num strong">${money(g.value)}</td>
      <td class="num">${num(g.invoices)}</td>
      <td class="num">${num(g.customers)}</td>
      <td>${escapeHtml(g.lastDate || "—")}</td>
    </tr>
  `).join("");
}

function openProductDrilldown(product) {
  DRILLDOWN_PRODUCT = product;
  const modal = document.getElementById("product-drilldown");
  document.getElementById("drilldown-title").textContent = product;
  document.getElementById("drilldown-search").value = "";
  document.getElementById("drilldown-sort").value = "value-desc";

  // Populate Month / Sale Type with values relevant to this product
  const targetKey = productKey(product);
  const productLines = flattenLineItems(state.rows).filter(li => li.productKey === targetKey);
  const months = [...new Set(productLines.map(l => l.month).filter(Boolean))].sort();
  const cats = saleTypeOptions(productLines.map(l => l.category));

  const mSel = document.getElementById("drilldown-month");
  mSel.innerHTML = `<option value="">All</option>`;
  months.forEach(m => {
    const o = document.createElement("option");
    o.value = m; o.textContent = monthLabel(m);
    mSel.appendChild(o);
  });
  const cSel = document.getElementById("drilldown-category");
  cSel.innerHTML = `<option value="">All</option>`;
  cats.forEach(([value, label]) => {
    const o = document.createElement("option");
    o.value = value; o.textContent = label;
    cSel.appendChild(o);
  });

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  renderDrilldown();
}

function closeProductDrilldown() {
  const modal = document.getElementById("product-drilldown");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  DRILLDOWN_PRODUCT = null;
}

function renderDrilldown() {
  if (!DRILLDOWN_PRODUCT) return;
  const product = DRILLDOWN_PRODUCT;
  const q = document.getElementById("drilldown-search").value.trim().toLowerCase();
  const sort = document.getElementById("drilldown-sort").value;
  const month = document.getElementById("drilldown-month").value;
  const cat = document.getElementById("drilldown-category").value;

  const targetKey = productKey(product);
  const lines = flattenLineItems(state.rows).filter(li => {
    if (li.productKey !== targetKey) return false;
    if (month && li.month !== month) return false;
    if (!saleTypeMatches(li.category, cat)) return false;
    if (q && !(li.customer || "").toLowerCase().includes(q)) return false;
    return true;
  });

  const byCustomer = new Map();
  lines.forEach(li => {
    const key = li.customer || "Unknown";
    const g = byCustomer.get(key) || {
      customer: key,
      gstin: null,
      quantity: 0,
      value: 0,
      invoices: new Set(),
      lastDate: null,
    };
    g.quantity += li.quantity;
    g.value += li.value;
    if (li.voucher_no) g.invoices.add(li.voucher_no);
    if (li.voucher_date && (!g.lastDate || li.voucher_date > g.lastDate)) g.lastDate = li.voucher_date;
    if (!g.gstin) {
      const voucher = state.rows.find(r => r.voucher_no === li.voucher_no);
      g.gstin = voucher?.gstin_uin || null;
    }
    byCustomer.set(key, g);
  });

  const rows = [...byCustomer.values()].map(g => ({
    customer: g.customer,
    gstin: g.gstin,
    quantity: g.quantity,
    value: g.value,
    avgRate: g.quantity > 0 ? g.value / g.quantity : 0,
    invoices: g.invoices.size,
    lastDate: g.lastDate,
  }));

  const cmp = {
    "value-desc": (a, b) => b.value - a.value,
    "value-asc": (a, b) => a.value - b.value,
    "qty-desc": (a, b) => b.quantity - a.quantity,
    "qty-asc": (a, b) => a.quantity - b.quantity,
    "invoices-desc": (a, b) => b.invoices - a.invoices,
    "recent": (a, b) => String(b.lastDate || "").localeCompare(String(a.lastDate || "")),
    "name-asc": (a, b) => a.customer.localeCompare(b.customer),
  }[sort] || ((a, b) => b.value - a.value);
  rows.sort(cmp);

  const totalQty = rows.reduce((a, r) => a + r.quantity, 0);
  const totalVal = rows.reduce((a, r) => a + r.value, 0);
  document.getElementById("drilldown-summary").textContent =
    `${num(rows.length)} customer${rows.length === 1 ? "" : "s"}  ·  ${num(totalQty)} qty  ·  ${money(totalVal)}`;

  const tbody = document.querySelector("#drilldown-table tbody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="txn-empty">No customers match your filters.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td class="customer" title="${escapeHtml(r.customer)}">${escapeHtml(r.customer)}</td>
      <td>${escapeHtml(r.gstin || "—")}</td>
      <td class="num">${num(r.quantity)}</td>
      <td class="num">${r.avgRate ? money(r.avgRate, true) : "—"}</td>
      <td class="num strong">${money(r.value)}</td>
      <td class="num">${num(r.invoices)}</td>
      <td>${escapeHtml(r.lastDate || "—")}</td>
    </tr>
  `).join("");
}

export function renderProducts() {
  const lineItems = flattenLineItems(state.rows);
  const st = getProductState();
  const groups = sortProducts(aggregateProducts(lineItems, st), st.sort);

  // Filter the totals/lineItems to match active filters so the summary is consistent
  const filteredLines = lineItems.filter(li => {
    return productLineMatches(li, st);
  });
  renderProductTotals(groups, filteredLines);
  renderProductInsights(groups, filteredLines);
  renderProductChart(groups);
  renderProductsTable(groups);
}

export function wireProducts() {
  const rerenderProducts = () => { PRODUCTS_PAGE = 1; renderProducts(); };
  ["products-search", "products-sort",
   "products-filter-category", "products-filter-market", "products-filter-material",
   "products-filter-salesperson", "products-filter-month", "products-filter-customer"
  ].forEach(id => {
    const el = document.getElementById(id);
    const eventName = el.tagName === "INPUT" ? "input" : "change";
    el.addEventListener(eventName, debounce(rerenderProducts, eventName === "input" ? 150 : 0));
  });
  document.getElementById("products-reset").addEventListener("click", () => {
    document.getElementById("products-search").value = "";
    document.getElementById("products-sort").value = "value-desc";
    document.getElementById("products-filter-category").value = "";
    document.getElementById("products-filter-market").value = "";
    document.getElementById("products-filter-material").value = "";
    document.getElementById("products-filter-salesperson").value = "";
    document.getElementById("products-filter-month").value = "";
    document.getElementById("products-filter-customer").value = "";
    PRODUCTS_PAGE = 1;
    renderProducts();
  });

  // Pager
  document.getElementById("products-page-size").addEventListener("change", () => {
    PRODUCTS_PAGE = 1; renderProducts();
  });
  document.getElementById("products-page-prev").addEventListener("click", () => {
    PRODUCTS_PAGE -= 1; renderProducts();
  });
  document.getElementById("products-page-next").addEventListener("click", () => {
    PRODUCTS_PAGE += 1; renderProducts();
  });

  // Custom chart controls — affect chart only, not pagination
  ["products-chart-type", "products-chart-measure", "products-chart-topn"].forEach(id => {
    document.getElementById(id).addEventListener("change", renderProducts);
  });

  // Drilldown: click a product row to see its customers
  document.querySelector("#products-table tbody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr.row-clickable");
    if (!tr) return;
    const product = tr.dataset.product;
    if (product) openProductDrilldown(product);
  });
  document.querySelectorAll("#product-drilldown [data-close]").forEach(el => {
    el.addEventListener("click", closeProductDrilldown);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("product-drilldown").classList.contains("hidden")) {
      closeProductDrilldown();
    }
  });
  ["drilldown-search", "drilldown-sort", "drilldown-month", "drilldown-category"].forEach(id => {
    const el = document.getElementById(id);
    const eventName = el.tagName === "INPUT" ? "input" : "change";
    el.addEventListener(eventName, debounce(renderDrilldown, eventName === "input" ? 150 : 0));
  });
  document.getElementById("drilldown-reset").addEventListener("click", () => {
    document.getElementById("drilldown-search").value = "";
    document.getElementById("drilldown-sort").value = "value-desc";
    document.getElementById("drilldown-month").value = "";
    document.getElementById("drilldown-category").value = "";
    renderDrilldown();
  });
}
