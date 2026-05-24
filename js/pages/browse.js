import { state } from "../state.js";
import { money, num, escapeHtml, debounce } from "../format.js";
import { normalizeLocationValue } from "../location.js";
import { renderTotals } from "../meta.js";
import { saleTypeMatches } from "../sale-type.js";

let CURRENT_PAGE = 1;
const EXPANDED_VOUCHERS = new Set();

function getBrowseState() {
  return {
    q: document.getElementById("search").value.trim().toLowerCase(),
    sort: document.getElementById("sort").value,
    cat: document.getElementById("filter-category").value,
    loc: document.getElementById("filter-location").value,
    vtype: document.getElementById("filter-vtype").value,
    month: document.getElementById("filter-month").value,
    day: document.getElementById("filter-day").value,
    pageSize: Number(document.getElementById("page-size").value) || 25,
  };
}

function applyFilters(rows, s) {
  return rows.filter(r => {
    if (!saleTypeMatches(r.category, s.cat)) return false;
    if (s.loc && normalizeLocationValue(r.location) !== s.loc) return false;
    if (s.vtype && r.voucher_type !== s.vtype) return false;
    if (s.month && (r.voucher_date || "").slice(0, 7) !== s.month) return false;
    if (s.day && r.voucher_date !== s.day) return false;
    if (s.q) {
      const hay = [r.particulars, r.voucher_no, r.gstin_uin, r.voucher_type, r.location, r.category]
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(s.q)) return false;
    }
    return true;
  });
}

function applySort(rows, sortKey) {
  const cmp = {
    "date-desc":     (a, b) => (b.voucher_date || "").localeCompare(a.voucher_date || ""),
    "date-asc":      (a, b) => (a.voucher_date || "").localeCompare(b.voucher_date || ""),
    "gross-desc":    (a, b) => (Number(b.gross_total) || 0) - (Number(a.gross_total) || 0),
    "gross-asc":     (a, b) => (Number(a.gross_total) || 0) - (Number(b.gross_total) || 0),
    "customer-asc":  (a, b) => (a.particulars || "").localeCompare(b.particulars || ""),
    "customer-desc": (a, b) => (b.particulars || "").localeCompare(a.particulars || ""),
  }[sortKey];
  return cmp ? [...rows].sort(cmp) : rows;
}

function renderPager(totalRows, pageSize) {
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  if (CURRENT_PAGE > totalPages) CURRENT_PAGE = totalPages;
  if (CURRENT_PAGE < 1) CURRENT_PAGE = 1;

  const prev = document.getElementById("page-prev");
  const next = document.getElementById("page-next");
  prev.disabled = CURRENT_PAGE <= 1 || totalRows === 0;
  next.disabled = CURRENT_PAGE >= totalPages || totalRows === 0;
  document.getElementById("page-status").textContent = `Page ${CURRENT_PAGE} of ${totalPages}`;
}

function renderLineItemsCell(lineItems) {
  if (!lineItems || !lineItems.length) {
    return `<div class="line-items-empty">No product lines recorded for this voucher.</div>`;
  }
  const totalQty = lineItems.reduce((a, li) => a + (Number(li.quantity) || 0), 0);
  const totalVal = lineItems.reduce((a, li) => a + (Number(li.value) || 0), 0);
  return `
    <div class="line-items-wrap">
      <table class="line-items-table">
        <thead>
          <tr>
            <th style="width:36px;">#</th>
            <th>Product</th>
            <th class="num">Quantity</th>
            <th class="num">Rate</th>
            <th class="num">Value</th>
          </tr>
        </thead>
        <tbody>
          ${lineItems.map(li => `
            <tr>
              <td class="muted">${escapeHtml(String(li.line_no ?? ""))}</td>
              <td class="customer" title="${escapeHtml(li.particulars || "")}">${escapeHtml(li.particulars || "—")}</td>
              <td class="num">${li.quantity != null ? num(li.quantity) : "—"}</td>
              <td class="num">${li.rate != null ? money(li.rate, true) : "—"}</td>
              <td class="num strong">${li.value != null ? money(li.value) : "—"}</td>
            </tr>
          `).join("")}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2">Total (${num(lineItems.length)} line${lineItems.length === 1 ? "" : "s"})</td>
            <td class="num">${num(totalQty)}</td>
            <td></td>
            <td class="num strong">${money(totalVal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

function renderList(rows, pageSize) {
  const tbody = document.querySelector("#txn-list tbody");
  renderPager(rows.length, pageSize);

  if (!rows.length) {
    document.getElementById("record-count").textContent = "0 transactions";
    tbody.innerHTML = `<tr><td colspan="10" class="txn-empty">No transactions match your filters.</td></tr>`;
    return;
  }

  const start = (CURRENT_PAGE - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const end = start + pageRows.length;
  document.getElementById("record-count").textContent =
    `${num(start + 1)}-${num(end)} of ${num(rows.length)} transaction${rows.length === 1 ? "" : "s"}`;

  tbody.innerHTML = pageRows.map(r => {
    const items = Array.isArray(r.line_items) ? r.line_items : [];
    const hasItems = items.length > 0;
    const vno = r.voucher_no || "";
    const isOpen = vno && EXPANDED_VOUCHERS.has(vno);
    const rowClasses = ["voucher-row"];
    if (hasItems) rowClasses.push("has-items");
    if (isOpen) rowClasses.push("is-open");
    return `
      <tr class="${rowClasses.join(" ")}" data-voucher="${escapeHtml(vno)}" aria-expanded="${isOpen}">
        <td>${escapeHtml(r.voucher_date || "")}</td>
        <td class="voucher">${escapeHtml(vno)}</td>
        <td class="customer" title="${escapeHtml(r.particulars || "")}">${escapeHtml(r.particulars || "—")}</td>
        <td>${escapeHtml(r.voucher_type || "")}</td>
        <td><span class="badge">${escapeHtml(r.category || "")}</span></td>
        <td>${escapeHtml(r.location || "—")}</td>
        <td>${escapeHtml(r.gstin_uin || "—")}</td>
        <td class="num">${r.quantity != null ? num(r.quantity) : "—"}</td>
        <td class="num">${r.taxable_value != null ? money(r.taxable_value) : "—"}</td>
        <td class="num">${r.gross_total != null ? money(r.gross_total) : "—"}</td>
      </tr>
      <tr class="line-items-row ${isOpen ? "" : "hidden"}" data-voucher-detail="${escapeHtml(vno)}">
        <td colspan="10">${renderLineItemsCell(items)}</td>
      </tr>
    `;
  }).join("");
}

function toggleVoucherExpansion(voucherNo) {
  if (!voucherNo) return;
  if (EXPANDED_VOUCHERS.has(voucherNo)) EXPANDED_VOUCHERS.delete(voucherNo);
  else EXPANDED_VOUCHERS.add(voucherNo);

  const row = document.querySelector(`#txn-list tbody tr.voucher-row[data-voucher="${CSS.escape(voucherNo)}"]`);
  const detail = document.querySelector(`#txn-list tbody tr.line-items-row[data-voucher-detail="${CSS.escape(voucherNo)}"]`);
  if (!row || !detail) return;

  const open = EXPANDED_VOUCHERS.has(voucherNo);
  row.classList.toggle("is-open", open);
  row.setAttribute("aria-expanded", String(open));
  detail.classList.toggle("hidden", !open);
}

export function renderBrowse() {
  const s = getBrowseState();
  const filtered = applyFilters(state.rows, s);
  const sorted = applySort(filtered, s.sort);
  renderTotals(filtered);
  renderList(sorted, s.pageSize);
}

export function wireBrowse() {
  const rerenderFromFirstPage = () => {
    CURRENT_PAGE = 1;
    renderBrowse();
  };
  document.getElementById("search").addEventListener("input", debounce(rerenderFromFirstPage, 150));
  document.getElementById("sort").addEventListener("change", rerenderFromFirstPage);
  document.getElementById("filter-category").addEventListener("change", rerenderFromFirstPage);
  document.getElementById("filter-location").addEventListener("change", rerenderFromFirstPage);
  document.getElementById("filter-vtype").addEventListener("change", rerenderFromFirstPage);
  document.getElementById("filter-month").addEventListener("change", rerenderFromFirstPage);
  document.getElementById("filter-day").addEventListener("change", rerenderFromFirstPage);
  document.getElementById("page-size").addEventListener("change", rerenderFromFirstPage);
  document.querySelector("#txn-list tbody").addEventListener("click", (e) => {
    const row = e.target.closest("tr.voucher-row.has-items");
    if (!row) return;
    toggleVoucherExpansion(row.dataset.voucher);
  });
  document.getElementById("page-prev").addEventListener("click", () => {
    CURRENT_PAGE -= 1;
    renderBrowse();
  });
  document.getElementById("page-next").addEventListener("click", () => {
    CURRENT_PAGE += 1;
    renderBrowse();
  });
  document.getElementById("reset").addEventListener("click", () => {
    document.getElementById("search").value = "";
    document.getElementById("sort").value = "date-desc";
    document.getElementById("filter-category").value = "";
    document.getElementById("filter-location").value = "";
    document.getElementById("filter-vtype").value = "";
    document.getElementById("filter-month").value = "";
    document.getElementById("filter-day").value = "";
    CURRENT_PAGE = 1;
    renderBrowse();
  });
}
