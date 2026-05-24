import { renderHome } from "./pages/home.js";
import { renderAnalysis } from "./pages/analysis.js";
import { renderKpi } from "./pages/kpi.js";
import { renderProducts } from "./pages/products.js";
import { renderBrowse } from "./pages/browse.js";
import { renderSalesTeam } from "./pages/sales-team.js";

export function routeFromHash() {
  const h = window.location.hash;
  const view =
    h === "#/records"    ? "records"    :
    h === "#/analysis"   ? "analysis"   :
    h === "#/kpi"        ? "kpi"        :
    h === "#/products"   ? "products"   :
    h === "#/sales-team" ? "sales-team" :
    "home";
  document.getElementById("page-home").classList.toggle("hidden", view !== "home");
  document.getElementById("page-analysis").classList.toggle("hidden", view !== "analysis");
  document.getElementById("page-kpi").classList.toggle("hidden", view !== "kpi");
  document.getElementById("page-products").classList.toggle("hidden", view !== "products");
  document.getElementById("page-sales-team").classList.toggle("hidden", view !== "sales-team");
  document.getElementById("page-browse").classList.toggle("hidden", view !== "records");
  document.querySelectorAll(".nav-link").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  if (view === "home") renderHome();
  if (view === "analysis") renderAnalysis();
  if (view === "kpi") renderKpi();
  if (view === "products") renderProducts();
  if (view === "sales-team") renderSalesTeam();
  if (view === "records") renderBrowse();
}
