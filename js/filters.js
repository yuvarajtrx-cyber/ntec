import { state } from "./state.js";
import { monthLabel } from "./format.js";
import { uniqueSorted, uniqueMonths, uniqueProducts } from "./rows.js";
import { uniqueLocations } from "./location.js";
import { flattenLineItems } from "./product-utils.js";
import { saleTypeOptions } from "./sale-type.js";

export function refreshFilterOptions() {
  const categorySel = document.getElementById("filter-category");
  const currentCategory = categorySel.value;
  categorySel.innerHTML = `<option value="">All</option>`;
  saleTypeOptions(state.rows.map(r => r.category)).forEach(([value, label]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    categorySel.appendChild(opt);
  });
  categorySel.value = currentCategory;

  const voucherTypeSel = document.getElementById("filter-vtype");
  const currentVoucherType = voucherTypeSel.value;
  voucherTypeSel.innerHTML = `<option value="">All</option>`;
  uniqueSorted(state.rows, "voucher_type").forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    voucherTypeSel.appendChild(opt);
  });
  voucherTypeSel.value = currentVoucherType;
  const locationSel = document.getElementById("filter-location");
  const currentLocation = locationSel.value;
  locationSel.innerHTML = `<option value="">All</option>`;
  uniqueLocations(state.rows).forEach(([value, label]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    locationSel.appendChild(opt);
  });
  locationSel.value = currentLocation;

  const monthSel = document.getElementById("filter-month");
  const currentMonth = monthSel.value;
  monthSel.innerHTML = `<option value="">All</option>`;
  uniqueMonths(state.rows).forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = monthLabel(v);
    monthSel.appendChild(opt);
  });
  monthSel.value = currentMonth;

  const analysisCategory = document.getElementById("analysis-category");
  const currentAnalysisCategory = analysisCategory.value;
  analysisCategory.innerHTML = `<option value="">All</option>`;
  uniqueSorted(state.rows, "category").forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    analysisCategory.appendChild(opt);
  });
  analysisCategory.value = currentAnalysisCategory;

  const analysisSalesperson = document.getElementById("analysis-salesperson");
  const currentAnalysisSalesperson = analysisSalesperson.value;
  analysisSalesperson.innerHTML = `<option value="">All</option>`;
  uniqueSorted(state.rows, "sales_person").forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    analysisSalesperson.appendChild(opt);
  });
  analysisSalesperson.value = currentAnalysisSalesperson;

  const analysisLocation = document.getElementById("analysis-location");
  const currentAnalysisLocation = analysisLocation.value;
  analysisLocation.innerHTML = `<option value="">All</option>`;
  uniqueLocations(state.rows).forEach(([value, label]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    analysisLocation.appendChild(opt);
  });
  analysisLocation.value = currentAnalysisLocation;

  const analysisMonth = document.getElementById("analysis-month");
  const currentAnalysisMonth = analysisMonth.value;
  analysisMonth.innerHTML = `<option value="">All</option>`;
  uniqueMonths(state.rows).forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = monthLabel(v);
    analysisMonth.appendChild(opt);
  });
  analysisMonth.value = currentAnalysisMonth;

  const analysisProduct = document.getElementById("analysis-product");
  const currentAnalysisProduct = analysisProduct.value;
  analysisProduct.innerHTML = `<option value="">All</option>`;
  uniqueProducts(state.rows).forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v.length > 60 ? v.slice(0, 58) + "…" : v;
    analysisProduct.appendChild(opt);
  });
  analysisProduct.value = currentAnalysisProduct;
}

export function refreshProductFilterOptions() {
  const lineItems = flattenLineItems(state.rows);

  const catSel = document.getElementById("products-filter-category");
  const curCat = catSel.value;
  catSel.innerHTML = `<option value="">All</option>`;
  [...new Set(lineItems.map(li => li.category).filter(Boolean))].sort().forEach(v => {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = v;
    catSel.appendChild(opt);
  });
  catSel.value = curCat;

  const personSel = document.getElementById("products-filter-salesperson");
  const curPerson = personSel.value;
  personSel.innerHTML = `<option value="">All</option>`;
  [...new Set(lineItems.map(li => li.sales_person).filter(Boolean))].sort().forEach(v => {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = v;
    personSel.appendChild(opt);
  });
  personSel.value = curPerson;

  const monthSel = document.getElementById("products-filter-month");
  const curMonth = monthSel.value;
  monthSel.innerHTML = `<option value="">All</option>`;
  [...new Set(lineItems.map(li => li.month).filter(Boolean))].sort().forEach(v => {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = monthLabel(v);
    monthSel.appendChild(opt);
  });
  monthSel.value = curMonth;

  const custSel = document.getElementById("products-filter-customer");
  const curCust = custSel.value;
  custSel.innerHTML = `<option value="">All</option>`;
  [...new Set(lineItems.map(li => li.customer).filter(Boolean))].sort().forEach(v => {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = v;
    custSel.appendChild(opt);
  });
  custSel.value = curCust;
}
