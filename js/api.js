import { state } from "./state.js";
import { setMeta } from "./meta.js";
import { showToast } from "./toast.js";
import { refreshFilterOptions, refreshProductFilterOptions } from "./filters.js";
import { renderBrowse } from "./pages/browse.js";
import { renderProducts } from "./pages/products.js";
import { renderKpi } from "./pages/kpi.js";
import { renderHome } from "./pages/home.js";
import { renderSalesTeam } from "./pages/sales-team.js";
import { renderCustomers } from "./pages/customers.js";
import { showConfirm } from "./confirm.js";
import { rangeQueryString } from "./data-range.js";

let csrfToken = "";

export async function loadSession() {
  const res = await fetch("/api/session", { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    window.location.href = "/login";
    throw new Error(data.error || "Authentication required");
  }
  csrfToken = data.csrfToken || "";
  state.session = data;
  state.permissions = new Set(data.permissions || []);
  return data;
}

export function can(permission) {
  return state.permissions.has(permission);
}

export function canAny(permissions) {
  return permissions.some(permission => can(permission));
}

export async function apiJson(path, options = {}) {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.method && options.method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(path, { ...options, headers, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

export async function apiDownload(path, payload) {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return { blob, filename: match?.[1] || "ntec-report" };
}

export async function fetchData(range = state.range) {
  const qs = rangeQueryString(range || {});
  const res = await fetch(`/api/sales${qs}`, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.error || `API ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

async function postUpload(file, mode) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("mode", mode);
  const res = await fetch(`/api/upload?mode=${encodeURIComponent(mode)}`, {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function uploadFile(file) {
  const btn = document.getElementById("upload-btn");
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="upload-icon">⟳</span> Uploading…`;
  showToast(`Uploading ${file.name}…`, "Reading file and checking for duplicates");

  try {
    let { ok, status, data } = await postUpload(file, "skip");
    if (!ok) {
      showToast("Upload failed", data.error || `HTTP ${status}`, "error");
      return;
    }

    const skipped = data.skipped_duplicates || 0;
    const inserted = data.inserted || 0;
    const samples = (data.duplicate_samples || []).slice(0, 5).join(", ");

    if (skipped > 0) {
      const sampleList = (data.duplicate_samples || []).slice(0, 10);
      const moreCount = (data.duplicate_samples || []).length - sampleList.length;
      const replace = await showConfirm({
        eyebrow: "Duplicate Vouchers Found",
        title: `${skipped} voucher${skipped === 1 ? "" : "s"} already exist in the database`,
        message:
          `Of ${skipped + inserted} voucher${(skipped + inserted) === 1 ? "" : "s"} in ${file.name}, ` +
          `${inserted} new one${inserted === 1 ? " was" : "s were"} inserted and ${skipped} ` +
          `match${skipped === 1 ? "es" : ""} an existing voucher number. ` +
          `Replace the existing ones with the versions from this file, or keep the database unchanged.`,
        details: sampleList.length ? {
          label: moreCount > 0 ? `Sample duplicates (showing ${sampleList.length} of ${skipped})` : "Duplicate voucher numbers",
          items: sampleList,
        } : null,
        okLabel: `Replace ${skipped} duplicate${skipped === 1 ? "" : "s"}`,
        cancelLabel: "Keep existing",
        danger: true,
      });
      if (replace) {
        showToast("Replacing duplicates…", `Re-uploading ${file.name} with replace mode`);
        const repl = await postUpload(file, "replace");
        if (!repl.ok) {
          showToast("Replace failed", repl.data.error || `HTTP ${repl.status}`, "error");
          return;
        }
        data = repl.data;
        showToast(
          `Replaced & inserted ${data.inserted} voucher${data.inserted === 1 ? "" : "s"}`,
          `${data.line_items_inserted ?? 0} line items · ${file.name}`,
          "success"
        );
      } else {
        showToast(
          `Inserted ${inserted} new, skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}`,
          samples ? `Duplicates: ${samples}` : `From ${data.filename}`,
          "success"
        );
      }
    } else {
      const dupInFile = data.file_internal_duplicates || 0;
      const dupNote = dupInFile ? ` · ${dupInFile} same-file duplicate${dupInFile === 1 ? "" : "s"} merged` : "";
      showToast(
        `Inserted ${inserted} voucher${inserted === 1 ? "" : "s"}`,
        `${data.line_items_inserted ?? 0} line items · ${data.filename}${dupNote}`,
        "success"
      );
    }
    await reloadData();
  } catch (e) {
    showToast("Upload failed", e.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

export async function uploadSalespersonFile(file) {
  const btn = document.getElementById("sp-upload-btn");
  const original = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="upload-icon">⟳</span> Uploading…`;
  }
  showToast(`Uploading ${file.name}…`, "Replacing salesperson mapping");

  const fd = new FormData();
  fd.append("file", file);

  try {
    const res = await fetch("/api/upload-salespersons", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast("Upload failed", data.error || `HTTP ${res.status}`, "error");
      return;
    }
    showToast(
      `Mapped ${data.inserted} customer${data.inserted === 1 ? "" : "s"}`,
      `From ${data.filename}`,
      "success"
    );
    await reloadData();
  } catch (e) {
    showToast("Upload failed", e.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }
}

export async function reloadData() {
  try {
    const payload = await fetchData();
    setMeta(payload);
    state.rows = payload.rows || [];
    refreshFilterOptions();
    refreshProductFilterOptions();
    renderBrowse();
    renderProducts();
    renderKpi();
    renderHome();
    renderSalesTeam();
    renderCustomers();
  } catch (e) {
    showToast("Failed to refresh data", e.message, "error");
  }
}
