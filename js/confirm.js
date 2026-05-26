import { escapeHtml } from "./format.js";

let _activeResolver = null;

function close(result) {
  document.getElementById("confirm-modal").classList.add("hidden");
  if (_activeResolver) {
    const r = _activeResolver;
    _activeResolver = null;
    r(result);
  }
}

export function wireConfirm() {
  const modal = document.getElementById("confirm-modal");
  if (!modal) return;
  modal.querySelectorAll("[data-confirm-close]").forEach(el =>
    el.addEventListener("click", () => close(false))
  );
  document.getElementById("confirm-cancel").addEventListener("click", () => close(false));
  document.getElementById("confirm-ok").addEventListener("click", () => close(true));
  document.addEventListener("keydown", e => {
    if (modal.classList.contains("hidden")) return;
    if (e.key === "Escape") close(false);
    if (e.key === "Enter")  close(true);
  });
}

/**
 * Show a confirm popup. Returns a Promise<boolean>.
 *   title       — header text
 *   eyebrow     — small label above title (defaults to "Confirm")
 *   message     — main body text/HTML (single paragraph)
 *   details     — { label, items[] } shown as a bulleted list (optional)
 *   okLabel     — primary button text (default "OK")
 *   cancelLabel — secondary button text (default "Cancel")
 *   danger      — if true, primary button gets a red style
 */
export function showConfirm({
  title = "Are you sure?",
  eyebrow = "Confirm",
  message = "",
  details = null,
  okLabel = "OK",
  cancelLabel = "Cancel",
  danger = false,
} = {}) {
  document.getElementById("confirm-eyebrow").textContent = eyebrow;
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-message").innerHTML = escapeHtml(message);

  const detailsWrap = document.getElementById("confirm-details");
  if (details && details.items && details.items.length) {
    document.getElementById("confirm-details-label").textContent = details.label || "Examples";
    document.getElementById("confirm-details-list").innerHTML =
      details.items.map(item => `<li>${escapeHtml(item)}</li>`).join("");
    detailsWrap.classList.remove("hidden");
  } else {
    detailsWrap.classList.add("hidden");
  }

  const okBtn = document.getElementById("confirm-ok");
  const cancelBtn = document.getElementById("confirm-cancel");
  okBtn.textContent = okLabel;
  cancelBtn.textContent = cancelLabel;
  okBtn.classList.toggle("btn-danger", !!danger);

  document.getElementById("confirm-modal").classList.remove("hidden");
  okBtn.focus();

  return new Promise(resolve => { _activeResolver = resolve; });
}
