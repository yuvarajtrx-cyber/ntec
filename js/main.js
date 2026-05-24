import { state } from "./state.js";
import { populateFilter, escapeHtml } from "./format.js";
import { uniqueSorted } from "./rows.js";
import { setMeta, setMetaError } from "./meta.js";
import { fetchData, uploadFile } from "./api.js";
import { refreshFilterOptions, refreshProductFilterOptions } from "./filters.js";
import { routeFromHash } from "./routing.js";
import { renderHome, wireHome } from "./pages/home.js";
import { renderAnalysis, wireAnalysis } from "./pages/analysis.js";
import { renderKpi, wireKpi } from "./pages/kpi.js";
import { renderProducts, wireProducts } from "./pages/products.js";
import { renderBrowse, wireBrowse } from "./pages/browse.js";
import { renderSalesTeam, wireSalesTeam } from "./pages/sales-team.js";

// Pages must be direct children of .main-shell so the CSS height/overflow chain
// (.main-shell → .page → .home-scroll) works. Modals are position:fixed, so
// they sit in their own slot outside the shell.
const PAGE_PARTIALS = [
  "pages/home.html",
  "pages/analysis.html",
  "pages/kpi.html",
  "pages/products.html",
  "pages/sales-team.html",
  "pages/browse.html",
];
const MODAL_PARTIALS = [
  "pages/modal-pivot.html",
  "pages/modal-product.html",
];

async function loadPartials() {
  const shell = document.querySelector(".main-shell");
  const modalSlot = document.getElementById("modal-slot");
  if (!shell) throw new Error("Missing .main-shell");
  if (!modalSlot) throw new Error("Missing #modal-slot");
  for (const path of PAGE_PARTIALS) {
    shell.insertAdjacentHTML("beforeend", await fetchPartial(path));
  }
  for (const path of MODAL_PARTIALS) {
    modalSlot.insertAdjacentHTML("beforeend", await fetchPartial(path));
  }
}

async function fetchPartial(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: HTTP ${res.status}`);
  return res.text();
}

function wireShell() {
  document.getElementById("sidebar-toggle").addEventListener("click", () => {
    document.querySelector(".app-shell").classList.toggle("sidebar-collapsed");
  });
  document.querySelectorAll(".nav-link").forEach(btn => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.view;
      window.location.hash =
        v === "records"    ? "#/records"    :
        v === "analysis"   ? "#/analysis"   :
        v === "kpi"        ? "#/kpi"        :
        v === "products"   ? "#/products"   :
        v === "sales-team" ? "#/sales-team" :
        "";
    });
  });
  document.getElementById("upload-btn").addEventListener("click", () => {
    document.getElementById("upload-input").click();
  });
  document.getElementById("upload-input").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) uploadFile(f);
    e.target.value = "";
  });
  window.addEventListener("hashchange", routeFromHash);
}

function renderEmptyState(message) {
  document.querySelector("#products-table tbody").innerHTML =
    `<tr><td colspan="7" class="txn-empty">${escapeHtml(message)}</td></tr>`;
  document.getElementById("insight-grid").innerHTML = "";
  document.getElementById("location-insights").innerHTML = `<div class="empty-panel">${escapeHtml(message)}</div>`;
  document.getElementById("customer-insights").innerHTML = `<div class="empty-panel">${escapeHtml(message)}</div>`;
  document.getElementById("analysis-summary").innerHTML = "";
  document.getElementById("analysis-table").innerHTML = "";
  document.querySelector("#txn-list tbody").innerHTML = `
    <tr><td colspan="11" class="txn-empty">
      ${escapeHtml(message)}<br><br>
      <small>Click <strong>Upload Excel</strong> in the top-right to add data.</small>
    </td></tr>
  `;
}

async function init() {
  await loadPartials();

  wireShell();
  wireBrowse();
  wireProducts();
  wireKpi();
  wireAnalysis();
  wireHome();
  wireSalesTeam();

  let payload = null;
  try {
    payload = await fetchData();
  } catch (e) {
    setMetaError(e.message);
    state.rows = [];
    renderEmptyState(e.message);
    renderKpi();
    routeFromHash();
    return;
  }

  setMeta(payload);
  state.rows = payload.rows || [];

  populateFilter("filter-category", uniqueSorted(state.rows, "category"));
  populateFilter("filter-vtype",    uniqueSorted(state.rows, "voucher_type"));
  refreshFilterOptions();
  refreshProductFilterOptions();

  renderHome();
  renderAnalysis();
  renderKpi();
  renderProducts();
  renderBrowse();
  renderSalesTeam();
  routeFromHash();
}

init();
