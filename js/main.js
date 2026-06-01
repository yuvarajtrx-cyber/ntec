import { state } from "./state.js";
import { populateFilter, escapeHtml } from "./format.js";
import { uniqueSorted } from "./rows.js";
import { setMeta, setMetaError } from "./meta.js";
import { apiJson, can, fetchData, loadSession, reloadData, uploadFile } from "./api.js";
import { refreshFilterOptions, refreshProductFilterOptions } from "./filters.js";
import { routeFromHash } from "./routing.js";
import { RANGE_PRESETS } from "./data-range.js";
import { renderHome, wireHome } from "./pages/home.js";
import { renderAnalysis, wireAnalysis } from "./pages/analysis.js";
import { renderKpi, wireKpi } from "./pages/kpi.js";
import { renderProducts, wireProducts } from "./pages/products.js";
import { renderBrowse, wireBrowse } from "./pages/browse.js";
import { renderSalesTeam, wireSalesTeam } from "./pages/sales-team.js";
import { renderCustomers, wireCustomers } from "./pages/customers.js";
import { renderQuality, wireQuality } from "./pages/quality.js";
import { renderAdminPage, wireAdmin } from "./pages/admin.js";
import { wireConfirm } from "./confirm.js";
import { showToast } from "./toast.js";

// Pages must be direct children of .main-shell so the CSS height/overflow chain
// (.main-shell → .page → .home-scroll) works. Modals are position:fixed, so
// they sit in their own slot outside the shell.
const PAGE_PARTIALS = [
  "pages/home.html",
  "pages/analysis.html",
  "pages/kpi.html",
  "pages/products.html",
  "pages/sales-team.html",
  "pages/customers.html",
  "pages/browse.html",
  "pages/quality.html",
  "pages/admin.html",
];
const MODAL_PARTIALS = [
  "pages/modal-pivot.html",
  "pages/modal-product.html",
  "pages/modal-confirm.html",
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

function injectRangeSelectors() {
  // The selector lives in every page's topbar so it's always visible. Each
  // copy stays in sync with the others through state.range and reloadData.
  const options = RANGE_PRESETS
    .map(p => `<option value="${p.value}">${p.label}</option>`)
    .join("");
  document.querySelectorAll(".topbar-right").forEach(host => {
    const wrap = document.createElement("label");
    wrap.className = "data-range-control";
    wrap.title = "Limits how much data the page loads from the server";
    wrap.innerHTML = `
      <span class="data-range-label">Data range</span>
      <select class="data-range-select">${options}</select>
    `;
    host.insertBefore(wrap, host.firstChild);
  });
}

async function applyRangePreset(preset) {
  state.range = { preset, from: null, to: null };
  document.querySelectorAll(".data-range-select").forEach(sel => {
    if (sel.value !== preset) sel.value = preset;
  });
  document.body.classList.add("data-range-loading");
  try {
    await reloadData();
  } finally {
    document.body.classList.remove("data-range-loading");
  }
}

function wireRangeSelectors() {
  document.querySelectorAll(".data-range-select").forEach(sel => {
    sel.value = state.range.preset;
    sel.addEventListener("change", () => applyRangePreset(sel.value));
  });
}

function wireShell() {
  const navPerms = {
    home: "page.home",
    analysis: "page.analysis",
    kpi: "page.kpi",
    products: "page.products",
    "sales-team": "page.sales_team",
    customers: "page.customers",
    records: "page.records",
    quality: "page.quality_tracker",
    admin: "admin.view",
  };
  document.querySelectorAll(".nav-link").forEach(btn => {
    const permission = navPerms[btn.dataset.view];
    if (permission && !can(permission)) btn.classList.add("hidden");
  });
  document.getElementById("upload-btn").classList.toggle("hidden", !can("sales.upload"));
  document.getElementById("sp-upload-btn")?.classList.toggle("hidden", !can("salesperson_map.upload"));
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
        v === "customers"  ? "#/customers"  :
        v === "quality"    ? "#/quality"    :
        v === "admin"      ? "#/admin"      :
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
  document.getElementById("logout-btn").addEventListener("click", () => {
    document.getElementById("logout-form").submit();
  });
  wireProfile();
  window.addEventListener("hashchange", routeFromHash);
}

function openProfile() {
  const session = state.session || {};
  document.getElementById("profile-username").textContent = session.username || "-";
  document.getElementById("profile-display").textContent = session.displayName || session.username || "-";
  document.getElementById("profile-department").textContent = session.department || "None";
  document.getElementById("profile-roles").textContent = (session.roles || []).map(r => r.name).join(", ") || "No roles";
  document.getElementById("profile-current-password").value = "";
  document.getElementById("profile-new-password").value = "";
  document.getElementById("profile-confirm-password").value = "";
  document.getElementById("profile-modal").classList.remove("hidden");
}

function closeProfile() {
  document.getElementById("profile-modal").classList.add("hidden");
}

function wireProfile() {
  document.getElementById("profile-btn").addEventListener("click", openProfile);
  document.querySelectorAll("[data-profile-close]").forEach(el => {
    el.addEventListener("click", closeProfile);
  });
  document.getElementById("profile-password-form").addEventListener("submit", async e => {
    e.preventDefault();
    const currentPassword = document.getElementById("profile-current-password").value;
    const newPassword = document.getElementById("profile-new-password").value;
    const confirmPassword = document.getElementById("profile-confirm-password").value;
    if (newPassword !== confirmPassword) {
      showToast("Password not changed", "New password and confirmation do not match", "error");
      return;
    }
    try {
      await apiJson("/api/profile/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      closeProfile();
      showToast("Password changed", "Use the new password next time you sign in", "success");
    } catch (err) {
      showToast("Password change failed", err.message, "error");
    }
  });
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
  await loadSession();
  await loadPartials();
  injectRangeSelectors();

  wireShell();
  wireRangeSelectors();
  wireBrowse();
  wireProducts();
  wireKpi();
  wireAnalysis();
  wireHome();
  wireSalesTeam();
  wireCustomers();
  wireQuality();
  wireAdmin();
  wireConfirm();

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
  renderCustomers();
  renderQuality();
  if (can("admin.view")) renderAdminPage();
  routeFromHash();
}

init();
