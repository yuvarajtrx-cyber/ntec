import { escapeHtml } from "./format.js";

let toastTimer = null;

export function showToast(title, detail = "", kind = "") {
  const el = document.getElementById("toast");
  el.innerHTML = `
    <div class="toast-title">${escapeHtml(title)}</div>
    ${detail ? `<div class="toast-detail">${escapeHtml(detail)}</div>` : ""}
  `;
  el.className = `toast ${kind}`.trim();
  if (toastTimer) clearTimeout(toastTimer);
  if (kind) toastTimer = setTimeout(hideToast, kind === "error" ? 6000 : 4000);
}

export function hideToast() {
  document.getElementById("toast").className = "toast hidden";
}
