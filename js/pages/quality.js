import { apiJson, can } from "../api.js";
import { escapeHtml } from "../format.js";
import { showToast } from "../toast.js";

let tickets = [];
let selectedTicket = null;
let selectedActions = [];
let activeFilter = "inbox";
let searchTerm = "";

const FILTERS = ["inbox", "open", "closed", "all"];
const OPEN_STATUSES = new Set(["open", "pending_approval", "changes_requested"]);
const CLOSED_STATUSES = new Set(["closed", "rejected"]);

const statusLabel = status => ({
  open: "Open",
  pending_approval: "Open",
  changes_requested: "Open",
  rejected: "Closed",
  closed: "Closed",
}[status] || status);

const actionLabel = action => ({
  approve: "Approved",
  reject: "Rejected",
  request_changes: "Requested Changes",
  close: "Closed",
  resubmit: "Resubmitted",
  raise: "Raised",
  raised: "Raised",
  routed: "Routed",
}[action] || action);

const actionTone = action => ({
  approve: "ok",
  reject: "bad",
  request_changes: "warn",
  close: "muted",
  resubmit: "info",
  raise: "info",
  raised: "info",
  routed: "info",
}[action] || "muted");

const dash = value => {
  if (value === null || value === undefined) return "-";
  const s = String(value);
  return s.trim() ? s : "-";
};

function money(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
}

function formatRelative(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

async function loadTickets() {
  const data = await apiJson("/api/quality/tickets");
  tickets = data.tickets || [];
}

function matchesFilter(ticket, filter) {
  if (filter === "all") return true;
  if (filter === "open") return OPEN_STATUSES.has(ticket.status);
  if (filter === "closed") return CLOSED_STATUSES.has(ticket.status);
  if (filter === "inbox") return ticket.can_act && OPEN_STATUSES.has(ticket.status);
  return true;
}

function counts() {
  return {
    inbox: tickets.filter(t => matchesFilter(t, "inbox")).length,
    open: tickets.filter(t => matchesFilter(t, "open")).length,
    closed: tickets.filter(t => matchesFilter(t, "closed")).length,
    all: tickets.length,
  };
}

function filteredTickets() {
  const term = searchTerm.trim().toLowerCase();
  return tickets.filter(ticket => {
    if (!matchesFilter(ticket, activeFilter)) return false;
    if (!term) return true;
    const haystack = `${ticket.ticket_no || ""} ${ticket.title || ""}`.toLowerCase();
    return haystack.includes(term);
  });
}

function renderChips() {
  const c = counts();
  document.getElementById("quality-chip-inbox").textContent = c.inbox;
  document.getElementById("quality-chip-open").textContent = c.open;
  document.getElementById("quality-chip-closed").textContent = c.closed;
  document.getElementById("quality-chip-all").textContent = c.all;
  document.querySelectorAll("[data-quality-filter]").forEach(btn => {
    const isActive = btn.dataset.qualityFilter === activeFilter;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  document.getElementById("quality-count").textContent =
    `${c.inbox} awaiting you · ${c.open} open · ${c.all} total`;
}

function renderTable() {
  const rows = filteredTickets();
  const tbody = document.querySelector("#quality-ticket-table tbody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="txn-empty">${escapeHtml(emptyMessage())}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(ticket => {
    const isClosed = CLOSED_STATUSES.has(ticket.status);
    const isSelected = selectedTicket && selectedTicket.id === ticket.id;
    const youFlag = ticket.can_act && OPEN_STATUSES.has(ticket.status)
      ? `<span class="quality-row-flag">You</span>` : "";
    return `
      <tr data-quality-ticket="${ticket.id}" class="${isSelected ? "selected" : ""}">
        <td>
          <div class="quality-row-title">
            <strong>${escapeHtml(ticket.ticket_no)}${youFlag}</strong>
            <small>${escapeHtml(ticket.title || "Untitled query")}</small>
          </div>
        </td>
        <td>${escapeHtml(ticket.nature)}</td>
        <td class="num">${money(ticket.value_amount)}</td>
        <td><span class="admin-status ${isClosed ? "inactive" : ""}">${escapeHtml(statusLabel(ticket.status))}</span></td>
        <td>${escapeHtml(ticket.current_step_name || "-")}</td>
        <td>${escapeHtml(ticket.raised_by_display || ticket.raised_by_username || "System")}</td>
        <td class="quality-row-when" title="${escapeHtml(formatDate(ticket.created_at))}">${escapeHtml(formatRelative(ticket.created_at))}</td>
      </tr>
    `;
  }).join("");
}

function emptyMessage() {
  if (searchTerm.trim()) return "No queries match your search.";
  if (activeFilter === "inbox") return "Nothing is waiting on you. Nice.";
  if (activeFilter === "open") return "No open queries.";
  if (activeFilter === "closed") return "No closed queries yet.";
  return "No quality queries yet.";
}

function renderDrawer() {
  const drawer = document.getElementById("quality-detail");
  if (!selectedTicket) {
    drawer.classList.add("hidden");
    drawer.setAttribute("aria-hidden", "true");
    return;
  }
  drawer.classList.remove("hidden");
  drawer.setAttribute("aria-hidden", "false");

  document.getElementById("quality-detail-ticket").textContent = selectedTicket.ticket_no || "Ticket";
  document.getElementById("quality-detail-title").textContent = selectedTicket.title || "—";
  document.getElementById("quality-detail-description").textContent = selectedTicket.description || "No description.";

  const statusEl = document.getElementById("quality-detail-status");
  const isClosed = CLOSED_STATUSES.has(selectedTicket.status);
  statusEl.className = `admin-status${isClosed ? " inactive" : ""}`;
  statusEl.textContent = statusLabel(selectedTicket.status);
  document.getElementById("quality-detail-step").textContent = selectedTicket.current_step_name
    ? `Current step: ${selectedTicket.current_step_name}`
    : "No active step";

  document.getElementById("quality-detail-meta").innerHTML = [
    ["Nature", dash(selectedTicket.nature)],
    ["Value", money(selectedTicket.value_amount)],
    ["Workflow", dash(selectedTicket.workflow_name)],
    ["Department", dash(selectedTicket.department_name)],
    ["Raised By", dash(selectedTicket.raised_by_display || selectedTicket.raised_by_username)],
    ["Created", formatDate(selectedTicket.created_at)],
  ].map(([label, value]) => `
    <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
  `).join("");

  const buttons = [];
  const isOpen = OPEN_STATUSES.has(selectedTicket.status);
  if (isOpen && selectedTicket.can_act && can("quality.approve")) {
    buttons.push(["approve", "Approve"], ["reject", "Reject"]);
  }
  const lastAction = selectedActions[selectedActions.length - 1]?.action;
  if (isOpen && lastAction === "request_changes" && selectedTicket.is_mine) {
    buttons.push(["resubmit", "Resubmit"]);
  }
  const actionButtons = document.getElementById("quality-action-buttons");
  const actionSection = document.getElementById("quality-action-section");
  const noAction = document.getElementById("quality-no-action");
  const commentField = document.getElementById("quality-action-comment").closest("label");
  if (buttons.length) {
    actionButtons.innerHTML = buttons.map(([action, label]) =>
      `<button type="button" data-quality-action="${action}">${escapeHtml(label)}</button>`
    ).join("");
    noAction.classList.add("hidden");
    commentField?.classList.remove("hidden");
  } else {
    actionButtons.innerHTML = "";
    noAction.classList.remove("hidden");
    commentField?.classList.add("hidden");
  }
  actionSection.classList.remove("hidden");

  document.getElementById("quality-history").innerHTML = selectedActions.map(action => {
    const isRaise = action.action === "raised" || action.action === "raise";
    const actor = dash(action.display_name || action.username || "System");
    const header = isRaise
      ? `${actionLabel(action.action)} · ${actor}`
      : `${actionLabel(action.action)} · ${dash(action.step_name)}`;
    const sub = isRaise
      ? escapeHtml(formatDate(action.created_at))
      : `${escapeHtml(actor)} · ${escapeHtml(formatDate(action.created_at))}`;
    return `
    <div class="quality-history-row" data-tone="${actionTone(action.action)}">
      <strong>${escapeHtml(header)}</strong>
      <small>${sub}</small>
      ${action.comment ? `<div>${escapeHtml(action.comment)}</div>` : ""}
    </div>
  `;
  }).join("") || `<div class="txn-empty">No history yet.</div>`;
}

function render() {
  renderChips();
  renderTable();
  renderDrawer();
}

async function openTicket(id) {
  try {
    const data = await apiJson(`/api/quality/tickets/${id}`);
    selectedTicket = data.ticket;
    selectedActions = data.actions || [];
    document.getElementById("quality-action-comment").value = "";
    render();
  } catch (err) {
    showToast("Ticket load failed", err.message, "error");
  }
}

function closeDrawer() {
  selectedTicket = null;
  selectedActions = [];
  renderDrawer();
  document.querySelectorAll("#quality-ticket-table tr.selected").forEach(tr => tr.classList.remove("selected"));
}

let routePreviewTimer = null;
let routeMatched = false;

function setRoutePreview(state, message) {
  const el = document.getElementById("quality-route-preview");
  const submit = document.getElementById("quality-raise-submit");
  if (el) {
    el.dataset.state = state;
    el.textContent = message;
  }
  routeMatched = state === "ok";
  if (submit) submit.disabled = !routeMatched;
}

async function refreshRoutePreview() {
  const nature = document.getElementById("quality-ticket-nature").value;
  const value = document.getElementById("quality-ticket-value").value;
  if (value === "" || value == null) {
    setRoutePreview("idle", "Enter a value to see where this query will route.");
    return;
  }
  setRoutePreview("loading", "Checking routing…");
  try {
    const params = new URLSearchParams({ nature, value });
    const data = await apiJson(`/api/quality/route-preview?${params.toString()}`);
    setRoutePreview(data.matched ? "ok" : "warn", data.message || (data.matched ? "Routes to a workflow." : "No workflow rule covers this."));
  } catch (err) {
    setRoutePreview("warn", err.message || "Could not check routing.");
  }
}

function scheduleRoutePreview() {
  clearTimeout(routePreviewTimer);
  routePreviewTimer = setTimeout(refreshRoutePreview, 250);
}

function openRaiseModal() {
  const modal = document.getElementById("quality-raise-modal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  setRoutePreview("idle", "Enter a value to see where this query will route.");
  setTimeout(() => document.getElementById("quality-ticket-title")?.focus(), 0);
}

function closeRaiseModal() {
  const modal = document.getElementById("quality-raise-modal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

async function refreshQuality() {
  await loadTickets();
  if (selectedTicket) {
    const exists = tickets.find(t => t.id === selectedTicket.id);
    if (exists) {
      try {
        const data = await apiJson(`/api/quality/tickets/${selectedTicket.id}`);
        selectedTicket = data.ticket;
        selectedActions = data.actions || [];
      } catch {
        selectedTicket = null;
        selectedActions = [];
      }
    } else {
      selectedTicket = null;
      selectedActions = [];
    }
  }
  render();
}

export async function renderQuality() {
  if (!can("page.quality_tracker")) return;
  try {
    await refreshQuality();
  } catch (err) {
    showToast("Quality load failed", err.message, "error");
  }
}

export function wireQuality() {
  const raiseBtn = document.getElementById("quality-raise-btn");
  const canRaise = can("quality.raise");
  raiseBtn.classList.toggle("hidden", !canRaise);

  raiseBtn.addEventListener("click", openRaiseModal);

  document.querySelectorAll("[data-quality-raise-close]").forEach(el =>
    el.addEventListener("click", closeRaiseModal));

  document.getElementById("quality-ticket-nature").addEventListener("change", scheduleRoutePreview);
  document.getElementById("quality-ticket-value").addEventListener("input", scheduleRoutePreview);

  document.getElementById("quality-ticket-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (!routeMatched) {
      await refreshRoutePreview();
      if (!routeMatched) return;
    }
    const payload = {
      nature: document.getElementById("quality-ticket-nature").value,
      valueAmount: document.getElementById("quality-ticket-value").value,
      title: document.getElementById("quality-ticket-title").value,
      description: document.getElementById("quality-ticket-description").value,
    };
    try {
      const result = await apiJson("/api/quality/tickets", { method: "POST", body: JSON.stringify(payload) });
      e.target.reset();
      setRoutePreview("idle", "Enter a value to see where this query will route.");
      closeRaiseModal();
      activeFilter = "open";
      await refreshQuality();
      if (result.id) await openTicket(result.id);
      showToast("Query raised", "Workflow routing has started", "success");
    } catch (err) {
      showToast("Query raise failed", err.message, "error");
    }
  });

  document.querySelectorAll("[data-quality-filter]").forEach(btn => {
    btn.addEventListener("click", () => {
      const f = btn.dataset.qualityFilter;
      if (!FILTERS.includes(f)) return;
      activeFilter = f;
      render();
    });
  });

  document.getElementById("quality-search").addEventListener("input", e => {
    searchTerm = e.target.value;
    renderTable();
  });

  document.querySelectorAll("[data-quality-detail-close]").forEach(el =>
    el.addEventListener("click", closeDrawer));

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!document.getElementById("quality-raise-modal").classList.contains("hidden")) {
      closeRaiseModal();
      return;
    }
    if (!document.getElementById("quality-detail").classList.contains("hidden")) {
      closeDrawer();
    }
  });

  document.getElementById("page-quality").addEventListener("click", async e => {
    const row = e.target.closest("[data-quality-ticket]");
    if (row) {
      await openTicket(row.dataset.qualityTicket);
      return;
    }
    const actionBtn = e.target.closest("[data-quality-action]");
    if (!actionBtn || !selectedTicket || actionBtn.disabled) return;
    const allButtons = document.querySelectorAll("#quality-action-buttons button");
    allButtons.forEach(b => { b.disabled = true; });
    try {
      await apiJson(`/api/quality/tickets/${selectedTicket.id}/action`, {
        method: "POST",
        body: JSON.stringify({
          action: actionBtn.dataset.qualityAction,
          comment: document.getElementById("quality-action-comment").value,
        }),
      });
      document.getElementById("quality-action-comment").value = "";
      await refreshQuality();
      showToast("Action saved", "Quality query moved forward", "success");
    } catch (err) {
      allButtons.forEach(b => { b.disabled = false; });
      showToast("Action failed", err.message, "error");
    }
  });
}
