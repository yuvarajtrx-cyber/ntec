import { apiDownload } from "./api.js";
import { showToast } from "./toast.js";

export const SALES_COLUMNS = [
  { key: "voucher_date", label: "Date" },
  { key: "voucher_no", label: "Voucher No." },
  { key: "particulars", label: "Customer" },
  { key: "voucher_type", label: "Voucher Type" },
  { key: "category", label: "Sale Type" },
  { key: "location", label: "Location" },
  { key: "sales_person", label: "Salesperson" },
  { key: "gstin_uin", label: "GSTIN" },
  { key: "quantity", label: "Quantity" },
  { key: "taxable_value", label: "Taxable" },
  { key: "gross_total", label: "Gross" },
];

export function salesRows(rows) {
  return rows.map(r => ({
    voucher_date: r.voucher_date || "",
    voucher_no: r.voucher_no || "",
    particulars: r.particulars || "",
    voucher_type: r.voucher_type || "",
    category: r.category || "",
    location: r.location || "",
    sales_person: r.sales_person || "Unassigned",
    gstin_uin: r.gstin_uin || "",
    quantity: Number(r.quantity) || 0,
    taxable_value: Number(r.taxable_value) || 0,
    gross_total: Number(r.gross_total) || 0,
  }));
}

function numericExportValue(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^([+-]?)\s*₹?\s*([\d,]+(?:\.\d+)?)\s*%?$/);
  if (!match) return value;
  return Number(`${match[1]}${match[2].replace(/,/g, "")}`);
}

export function summaryFromCards(selector) {
  return [...document.querySelectorAll(`${selector} .insight-card`)].map(card => ({
    label: card.querySelector("span")?.textContent?.trim() || "",
    value: numericExportValue(card.querySelector("strong")?.textContent?.trim() || ""),
  })).filter(item => item.label && item.value !== "");
}

export function filtersFromControls(items) {
  return items.map(([label, id]) => {
    const el = document.getElementById(id);
    if (!el) return null;
    let value = "";
    if (el?.tagName === "SELECT") {
      if (!el.value) return null;
      value = el.selectedOptions?.[0]?.textContent?.trim() || "";
    } else {
      value = el?.value?.trim() || "";
    }
    if (!value || value === "All") return null;
    return { label, value };
  }).filter(item => item?.label && item?.value);
}

export function tableSectionFromDom(title, tableId) {
  const table = document.getElementById(tableId);
  const headers = [...(table?.querySelectorAll("thead th") || [])].map((th, idx) => ({
    key: `c${idx}`,
    label: th.textContent.trim(),
  }));
  const rows = [...(table?.querySelectorAll("tbody tr") || [])]
    .filter(tr => !tr.classList.contains("hidden") && !tr.querySelector(".txn-empty"))
    .map(tr => {
      const row = {};
      [...tr.children].slice(0, headers.length).forEach((td, idx) => {
        const value = td.textContent.trim().replace(/\s+/g, " ");
        row[`c${idx}`] = td.classList.contains("num") ? numericExportValue(value) : value;
      });
      return row;
    });
  return { title, columns: headers, rows };
}

export function wireExportActions({ excelId, pdfId, buildPayload }) {
  const run = async (format, button) => {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = format === "excel" ? "Exporting..." : "Preparing...";
    try {
      const payload = buildPayload();
      if (format === "pdf") {
        printReportPayload(payload);
        return;
      }
      const { blob, filename } = await apiDownload(`/api/export/${format}`, payload);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("Report exported", filename, "success");
    } catch (err) {
      showToast("Export failed", err.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  };

  const excel = document.getElementById(excelId);
  const pdf = document.getElementById(pdfId);
  excel?.addEventListener("click", () => run("excel", excel));
  pdf?.addEventListener("click", () => run("pdf", pdf));
}

function printReportPayload(payload) {
  const win = window.open("", "_blank");
  if (!win) {
    throw new Error("Popup blocked. Allow popups for this site and try again.");
  }
  const title = payload.title || "NTEC Report";
  win.document.open();
  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${escapeHtml(title)}</title>
      <style>
        @page { size: A4 landscape; margin: 10mm; }
        * { box-sizing: border-box; }
        html {
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }
        body {
          margin: 0;
          color: #111827;
          background: #fff;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
          font-size: 11px;
        }
        header {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          border-bottom: 4px solid #4f46e5;
          padding: 14px 16px;
          margin-bottom: 14px;
          background: #eef2ff;
          border-radius: 8px;
        }
        h1 { margin: 0; font-size: 22px; }
        h2 { margin: 18px 0 8px; font-size: 15px; }
        .muted { color: #6b7280; }
        .filters, .summary {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
          margin-bottom: 14px;
        }
        .box {
          border: 1px solid #c7d2fe;
          border-radius: 6px;
          padding: 8px;
          break-inside: avoid;
          background: #f8fafc;
        }
        .box span {
          display: block;
          color: #6b7280;
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: .04em;
        }
        .box strong {
          display: block;
          margin-top: 2px;
          font-size: 13px;
          color: #312e81;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          margin-bottom: 14px;
        }
        th, td {
          border: 1px solid #e5e7eb;
          padding: 5px 6px;
          text-align: left;
          vertical-align: top;
          overflow-wrap: anywhere;
        }
        th {
          background: #4f46e5;
          color: #fff;
          font-weight: 700;
        }
        tr:nth-child(even) td { background: #f9fafb; }
        tr:nth-child(odd) td { background: #fff; }
        tbody tr:nth-child(even) td { background: #eef2ff; }
        tbody tr:hover td { background: #e0e7ff; }
        .section { break-inside: avoid; }
        .empty { color: #6b7280; font-style: italic; }
        @media print {
          * {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
          .no-print { display: none !important; }
          header, .box, tr { break-inside: avoid; }
        }
      </style>
    </head>
    <body>
      <header>
        <div>
          <h1>${escapeHtml(title)}</h1>
          <div class="muted">${escapeHtml(new Date().toLocaleString())}</div>
        </div>
        <div class="muted">NTEC Sales Dashboard</div>
      </header>
      ${renderReportBlocks("Report Details", payload.filters)}
      ${renderReportBlocks("Summary", payload.summary)}
      ${(payload.sections || []).map(renderReportSection).join("")}
    </body>
    </html>
  `);
  win.document.close();
  const triggerPrint = () => {
    try {
      win.focus();
      setTimeout(() => win.print(), 50);
    } catch {}
  };
  if (win.document.readyState === "complete") {
    triggerPrint();
  } else {
    win.addEventListener("load", triggerPrint, { once: true });
  }
}

function renderReportBlocks(title, items = []) {
  const cleanItems = items.filter(item => item?.label && item?.value);
  if (!cleanItems.length) return "";
  return `
    <h2>${escapeHtml(title)}</h2>
    <div class="report-details">
      ${cleanItems.map(item => `
        <div class="box">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value)}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function renderReportSection(section) {
  const columns = section.columns || [];
  const rows = section.rows || [];
  if (!columns.length) return "";
  return `
    <section class="section">
      <h2>${escapeHtml(section.title || "Data")} <span class="muted">(${rows.length} rows)</span></h2>
      <table>
        <thead>
          <tr>${columns.map(col => `<th>${escapeHtml(col.label || col.key)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.length ? rows.map(row => `
            <tr>${columns.map(col => `<td>${escapeHtml(formatCell(row[col.key]))}</td>`).join("")}</tr>
          `).join("") : `<tr><td colspan="${columns.length}" class="empty">No rows match the current filters.</td></tr>`}
        </tbody>
      </table>
    </section>
  `;
}

function formatCell(value) {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "";
  return String(value);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[ch]));
}
