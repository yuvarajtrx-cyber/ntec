import { state } from "./state.js";
import { populateFilter, escapeHtml } from "./format.js";
import { uniqueSorted } from "./rows.js";
import { setMeta, setMetaError } from "./meta.js";
import { apiJson, can, fetchData, loadSession, reloadData, syncRangeFromPayload, uploadFile } from "./api.js";
import { refreshFilterOptions, refreshProductFilterOptions } from "./filters.js";
import { routeFromHash } from "./routing.js";
import { formatYearsLabel } from "./data-range.js";
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

// Working set of checked years inside an open popover. Committed to
// state.range.years on Apply; discarded on Cancel.
let DRAFT_YEARS = new Set();

function injectRangeSelectors() {
  // One button per page topbar; clicking opens a popover with year checkboxes.
  // Buttons stay in sync via syncRangeButtons() after every fetch.
  document.querySelectorAll(".topbar-right").forEach(host => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "data-range-btn";
    btn.title = "Choose which years to load from the server";
    btn.innerHTML = `
      <span class="data-range-label">Years</span>
      <span class="data-range-value">—</span>
      <span class="data-range-caret">▾</span>
    `;
    host.insertBefore(btn, host.firstChild);
  });

  const pop = document.createElement("div");
  pop.id = "data-range-popover";
  pop.className = "data-range-popover hidden";
  pop.innerHTML = `
    <div class="data-range-pop-head">Load data for…</div>
    <div class="data-range-pop-actions-top">
      <button type="button" data-act="all">Select all</button>
      <button type="button" data-act="none">Clear</button>
    </div>
    <div class="data-range-pop-list" id="data-range-pop-list"></div>
    <div class="data-range-pop-actions">
      <button type="button" class="ghost" data-act="cancel">Cancel</button>
      <button type="button" class="primary" data-act="apply">Apply</button>
    </div>
  `;
  document.body.appendChild(pop);
}

function syncRangeButtons() {
  const label = formatYearsLabel(state.range.years);
  document.querySelectorAll(".data-range-btn .data-range-value").forEach(el => {
    el.textContent = label;
  });
}

function openRangePopover(anchorBtn) {
  const pop = document.getElementById("data-range-popover");
  const list = document.getElementById("data-range-pop-list");
  const available = state.range.availableYears || [];
  DRAFT_YEARS = new Set(state.range.years);
  list.innerHTML = available.length
    ? [...available].sort((a, b) => b - a).map(y => `
        <label class="data-range-pop-row">
          <input type="checkbox" value="${y}" ${DRAFT_YEARS.has(y) ? "checked" : ""}>
          <span>${y}</span>
        </label>
      `).join("")
    : `<div class="data-range-pop-empty">No data uploaded yet.</div>`;

  const rect = anchorBtn.getBoundingClientRect();
  pop.style.top = `${rect.bottom + 6}px`;
  pop.style.right = `${window.innerWidth - rect.right}px`;
  pop.classList.remove("hidden");
  pop.dataset.anchor = anchorBtn.id || "";
}

function closeRangePopover() {
  document.getElementById("data-range-popover").classList.add("hidden");
}

async function applyDraftYears() {
  const years = [...DRAFT_YEARS].sort((a, b) => a - b);
  if (years.length === 0) {
    showToast("Pick at least one year", "Select one or more years to load.", "error");
    return;
  }
  state.range = { ...state.range, years };
  closeRangePopover();
  document.body.classList.add("data-range-loading");
  try {
    await reloadData();
    syncRangeButtons();
  } finally {
    document.body.classList.remove("data-range-loading");
  }
}

function wireRangeSelectors() {
  const pop = document.getElementById("data-range-popover");
  document.querySelectorAll(".data-range-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      if (!pop.classList.contains("hidden")) {
        closeRangePopover();
        return;
      }
      openRangePopover(btn);
    });
  });
  pop.addEventListener("click", e => {
    const target = e.target;
    if (target.matches("input[type=checkbox]")) {
      const y = Number(target.value);
      if (target.checked) DRAFT_YEARS.add(y);
      else DRAFT_YEARS.delete(y);
      return;
    }
    const act = target.dataset?.act;
    if (!act) return;
    if (act === "all") {
      DRAFT_YEARS = new Set(state.range.availableYears || []);
      pop.querySelectorAll("input[type=checkbox]").forEach(cb => { cb.checked = true; });
    } else if (act === "none") {
      DRAFT_YEARS.clear();
      pop.querySelectorAll("input[type=checkbox]").forEach(cb => { cb.checked = false; });
    } else if (act === "cancel") {
      closeRangePopover();
    } else if (act === "apply") {
      applyDraftYears();
    }
  });
  document.addEventListener("click", e => {
    if (pop.classList.contains("hidden")) return;
    if (pop.contains(e.target)) return;
    if (e.target.closest(".data-range-btn")) return;
    closeRangePopover();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !pop.classList.contains("hidden")) closeRangePopover();
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
  syncRangeFromPayload(payload);
  syncRangeButtons();

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
