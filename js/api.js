import { state } from "./state.js";
import { setMeta } from "./meta.js";
import { showToast } from "./toast.js";
import { refreshFilterOptions, refreshProductFilterOptions } from "./filters.js";
import { renderBrowse } from "./pages/browse.js";
import { renderProducts } from "./pages/products.js";
import { renderKpi } from "./pages/kpi.js";
import { renderHome } from "./pages/home.js";
import { renderSalesTeam } from "./pages/sales-team.js";

export async function fetchData() {
  const res = await fetch("/api/sales", { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.error || `API ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

export async function uploadFile(file) {
  const btn = document.getElementById("upload-btn");
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="upload-icon">⟳</span> Uploading…`;
  showToast(`Uploading ${file.name}…`, "Reading file and inserting into Postgres");

  const fd = new FormData();
  fd.append("file", file);

  try {
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast("Upload failed", data.error || `HTTP ${res.status}`, "error");
      return;
    }
    showToast(
      `Inserted ${data.inserted} voucher${data.inserted === 1 ? "" : "s"}`,
      `${data.line_items_inserted ?? 0} product line${(data.line_items_inserted ?? 0) === 1 ? "" : "s"} from ${data.filename}`,
      "success"
    );
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
    const res = await fetch("/api/upload-salespersons", { method: "POST", body: fd });
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
  } catch (e) {
    showToast("Failed to refresh data", e.message, "error");
  }
}
