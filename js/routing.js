import { renderHome } from "./pages/home.js";
import { renderAnalysis } from "./pages/analysis.js";
import { renderKpi } from "./pages/kpi.js";
import { renderProducts } from "./pages/products.js";
import { renderBrowse } from "./pages/browse.js";
import { renderSalesTeam } from "./pages/sales-team.js";
import { renderCustomers } from "./pages/customers.js";
import { renderAdminPage } from "./pages/admin.js";
import { can } from "./api.js";

const VIEW_PERMS = {
  home: "page.home",
  analysis: "page.analysis",
  kpi: "page.kpi",
  products: "page.products",
  "sales-team": "page.sales_team",
  customers: "page.customers",
  records: "page.records",
  admin: "admin.view",
};

function firstAllowedView() {
  return Object.keys(VIEW_PERMS).find(view => can(VIEW_PERMS[view])) || "home";
}

function pageIds() {
  return ["home", "analysis", "kpi", "products", "sales-team", "customers", "browse", "admin"];
}

export function routeFromHash() {
  const h = window.location.hash;
  let view =
    h === "#/records"    ? "records"    :
    h === "#/analysis"   ? "analysis"   :
    h === "#/kpi"        ? "kpi"        :
    h === "#/products"   ? "products"   :
    h === "#/sales-team" ? "sales-team" :
    h === "#/customers"  ? "customers"  :
    h === "#/admin"      ? "admin"      :
    "home";
  if (!can(VIEW_PERMS[view])) view = firstAllowedView();
  if (!can(VIEW_PERMS[view])) {
    pageIds().forEach(id => document.getElementById(`page-${id}`)?.classList.add("hidden"));
    const shell = document.querySelector(".main-shell");
    if (shell && !document.getElementById("no-access-page")) {
      shell.insertAdjacentHTML("beforeend", `
        <div id="no-access-page" class="page">
          <header class="topbar"><div><h1>No Access</h1><p class="subtitle">Ask the admin to assign a role.</p></div></header>
        </div>
      `);
    }
    return;
  }
  document.getElementById("no-access-page")?.remove();
  document.getElementById("page-home").classList.toggle("hidden", view !== "home");
  document.getElementById("page-analysis").classList.toggle("hidden", view !== "analysis");
  document.getElementById("page-kpi").classList.toggle("hidden", view !== "kpi");
  document.getElementById("page-products").classList.toggle("hidden", view !== "products");
  document.getElementById("page-sales-team").classList.toggle("hidden", view !== "sales-team");
  document.getElementById("page-customers").classList.toggle("hidden", view !== "customers");
  document.getElementById("page-browse").classList.toggle("hidden", view !== "records");
  document.getElementById("page-admin").classList.toggle("hidden", view !== "admin");
  document.querySelectorAll(".nav-link").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  if (view === "home") renderHome();
  if (view === "analysis") renderAnalysis();
  if (view === "kpi") renderKpi();
  if (view === "products") renderProducts();
  if (view === "sales-team") renderSalesTeam();
  if (view === "customers") renderCustomers();
  if (view === "records") renderBrowse();
  if (view === "admin") renderAdminPage();
}
