import { apiJson, can } from "../api.js";
import { escapeHtml } from "../format.js";
import { state } from "../state.js";
import { showToast } from "../toast.js";
import { showConfirm } from "../confirm.js";

let loaded = false;
let users = [];
let roles = [];
let departments = [];
let permissions = [];
let auditLogs = [];
let qualityWorkflows = [];
let qualityRules = [];

const ADMIN_ROLE_NAME = "Admin";
const SYSTEM_ADMIN_PERMISSIONS = new Set(["admin.view", "users.manage", "roles.manage", "departments.manage"]);
const boolValue = id => document.getElementById(id).value === "true";
const selectedChecks = name => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(x => x.value);
const activeCount = rows => rows.filter(row => row.is_active).length;
const isSystemAdminRole = role => role.name === ADMIN_ROLE_NAME;
const isSystemAdminUser = user => (user.roles || []).some(isSystemAdminRole);

function switchAdminTab(tabName) {
  const tab = document.querySelector(`[data-admin-tab="${tabName}"]`);
  if (!tab || tab.classList.contains("hidden")) return;
  document.querySelectorAll(".admin-tab").forEach(t => t.classList.toggle("active", t === tab));
  document.querySelectorAll("[data-admin-panel]").forEach(panel => {
    panel.classList.toggle("hidden", panel.dataset.adminPanel !== tabName);
  });
}

async function loadAdminData() {
  if (!can("admin.view")) {
    loaded = true;
    return;
  }
  const requests = [
    apiJson("/api/admin/permissions"),
    can("users.manage") ? apiJson("/api/admin/users") : Promise.resolve({ users: [] }),
    can("roles.manage") || can("users.manage") || can("quality.workflow.manage") ? apiJson("/api/admin/roles") : Promise.resolve({ roles: [] }),
    can("departments.manage") || can("users.manage") ? apiJson("/api/admin/departments") : Promise.resolve({ departments: [] }),
    apiJson("/api/admin/audit-log?limit=150"),
    can("quality.workflow.manage") ? apiJson("/api/admin/quality/workflows") : Promise.resolve({ workflows: [] }),
    can("quality.workflow.manage") ? apiJson("/api/admin/quality/rules") : Promise.resolve({ rules: [] }),
  ];
  const [perms, userData, roleData, deptData, auditData, workflowData, ruleData] = await Promise.all(requests);
  permissions = perms.permissions || [];
  users = userData.users || [];
  roles = roleData.roles || [];
  departments = deptData.departments || [];
  auditLogs = auditData.logs || [];
  qualityWorkflows = workflowData.workflows || [];
  qualityRules = ruleData.rules || [];
  loaded = true;
}

function renderRoleChecks(selected = []) {
  const chosen = new Set(selected.map(String));
  document.getElementById("admin-user-roles").innerHTML = roles
    .filter(r => !isSystemAdminRole(r))
    .filter(r => r.is_active || chosen.has(String(r.id)))
    .map(role => `
      <label class="check-row">
        <input type="checkbox" name="admin-user-role" value="${role.id}" ${chosen.has(String(role.id)) ? "checked" : ""} />
        <span>${escapeHtml(role.name)}${role.is_active ? "" : " (inactive)"}</span>
      </label>
    `).join("") || `<div class="txn-empty">No roles available.</div>`;
}

function renderDepartmentOptions(selected = "") {
  document.getElementById("admin-user-department").innerHTML =
    `<option value="">Choose department</option>` +
    departments
      .filter(d => d.is_active || String(d.id) === String(selected))
      .map(d => `<option value="${d.id}" ${String(d.id) === String(selected) ? "selected" : ""}>${escapeHtml(d.name)}${d.is_active ? "" : " (inactive)"}</option>`)
      .join("");
}

function renderPermissionChecks(selected = []) {
  const chosen = new Set(selected);
  const grouped = permissions
    .filter(p => !SYSTEM_ADMIN_PERMISSIONS.has(p.key))
    .reduce((acc, p) => {
    (acc[p.category] ||= []).push(p);
    return acc;
  }, {});
  document.getElementById("admin-role-permissions").innerHTML = Object.entries(grouped).map(([category, rows]) => `
    <div class="permission-group">
      <strong>${escapeHtml(category)}</strong>
      ${rows.map(p => `
        <label class="check-row">
          <input type="checkbox" name="admin-role-permission" value="${escapeHtml(p.key)}" ${chosen.has(p.key) ? "checked" : ""} />
          <span>${escapeHtml(p.label)}</span>
        </label>
      `).join("")}
    </div>
  `).join("");
}

function statusBadge(active) {
  return `<span class="admin-status ${active ? "" : "inactive"}">${active ? "Active" : "Inactive"}</span>`;
}

function renderUsers() {
  const me = state.session || {};
  document.querySelector("#admin-users-table tbody").innerHTML = users.map(user => {
    const isSelf = String(me.id || "") === String(user.id);
    return `
    <tr>
      <td>
        <strong>${escapeHtml(user.username)}</strong><br>
        <small>${escapeHtml(user.display_name || "")}</small>
      </td>
      <td>${escapeHtml(user.department_name || "None")}</td>
      <td>${escapeHtml((user.roles || []).map(r => r.name).join(", ") || "No roles")}</td>
      <td>${statusBadge(user.is_active)}</td>
      <td class="num">${
        isSystemAdminUser(user)
          ? `<span class="admin-locked">Fixed admin</span>`
          : `<button class="admin-row-btn" type="button" data-edit-user="${user.id}">Edit</button>` +
            (isSelf ? "" : `<button class="admin-row-btn admin-row-btn-danger" type="button" data-delete-user="${user.id}">Remove</button>`)
      }</td>
    </tr>
    `;
  }).join("") || `<tr><td colspan="5" class="txn-empty">No users found.</td></tr>`;
}

function renderRoles() {
  document.querySelector("#admin-roles-table tbody").innerHTML = roles.map(role => `
    <tr>
      <td>
        <strong>${escapeHtml(role.name)}</strong><br>
        <small>${escapeHtml(role.description || "")}</small>
      </td>
      <td>${isSystemAdminRole(role) ? "System controlled" : escapeHtml((role.permissions || []).join(", ") || "No permissions")}</td>
      <td>${statusBadge(role.is_active)}</td>
      <td class="num">${
        isSystemAdminRole(role)
          ? `<span class="admin-locked">Fixed role</span>`
          : `<button class="admin-row-btn" type="button" data-edit-role="${role.id}">Edit</button>
             <button class="admin-row-btn admin-row-btn-danger" type="button" data-delete-role="${role.id}">Remove</button>`
      }</td>
    </tr>
  `).join("") || `<tr><td colspan="4" class="txn-empty">No roles found.</td></tr>`;
}

function renderDepartments() {
  document.querySelector("#admin-departments-table tbody").innerHTML = departments.map(dept => `
    <tr>
      <td>${escapeHtml(dept.name)}</td>
      <td>${statusBadge(dept.is_active)}</td>
      <td class="num">
        <button class="admin-row-btn" type="button" data-edit-department="${dept.id}">Edit</button>
        <button class="admin-row-btn admin-row-btn-danger" type="button" data-delete-department="${dept.id}">Remove</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="3" class="txn-empty">No departments found.</td></tr>`;
}

function renderAuditLogs() {
  document.querySelector("#admin-audit-table tbody").innerHTML = auditLogs.map(log => {
    const detail = log.detail && Object.keys(log.detail).length ? JSON.stringify(log.detail) : "";
    const target = [log.target_type, log.target_id].filter(Boolean).join(" #");
    return `
      <tr>
        <td>${escapeHtml(new Date(log.created_at).toLocaleString())}</td>
        <td>${escapeHtml(log.actor_username || "System")}</td>
        <td>${escapeHtml(log.action)}</td>
        <td>${escapeHtml(target || "-")}</td>
        <td>${escapeHtml(detail)}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="5" class="txn-empty">No audit events yet.</td></tr>`;
}

function optionRows(rows, selected, labelKey = "name") {
  return `<option value="">Any</option>` + rows
    .filter(row => row.is_active !== false || String(row.id) === String(selected))
    .map(row => `<option value="${row.id}" ${String(row.id) === String(selected) ? "selected" : ""}>${escapeHtml(row[labelKey] || row.username)}</option>`)
    .join("");
}

function stepRowTemplate(step = {}) {
  return `
    <div class="quality-step-row" data-quality-step>
      <label>Step Name <input data-step-name value="${escapeHtml(step.name || "")}" required placeholder="e.g. Manager Approval" /></label>
      <label>Role <select data-step-role>${optionRows(roles.filter(r => !isSystemAdminRole(r)), step.role_id)}</select></label>
      <label>Department <select data-step-department>${optionRows(departments, step.department_id)}</select></label>
      <label>User <select data-step-user>${optionRows(users.filter(u => !isSystemAdminUser(u)), step.user_id, "username")}</select></label>
      <button class="admin-row-btn" type="button" data-remove-quality-step>Remove</button>
    </div>
  `;
}

function renderWorkflowSteps(steps = []) {
  document.getElementById("quality-workflow-steps").innerHTML =
    steps.map(step => stepRowTemplate(step)).join("");
}

function readWorkflowSteps() {
  const rows = [...document.querySelectorAll("[data-quality-step]")];
  return rows.map((row, index) => ({
    name: row.querySelector("[data-step-name]").value,
    roleId: row.querySelector("[data-step-role]").value || null,
    departmentId: row.querySelector("[data-step-department]").value || null,
    userId: row.querySelector("[data-step-user]").value || null,
    isFinal: index === rows.length - 1,
  }));
}

function renderQualityWorkflowOptions(selected = "") {
  document.getElementById("quality-rule-workflow").innerHTML =
    qualityWorkflows
      .filter(w => w.is_active || String(w.id) === String(selected))
      .map(w => `<option value="${w.id}" ${String(w.id) === String(selected) ? "selected" : ""}>${escapeHtml(w.name)}</option>`)
      .join("");
}

function renderQualityRuleRoleOptions(selected = "") {
  const sel = String(selected ?? "");
  document.getElementById("quality-rule-initiator-role").innerHTML =
    `<option value="" ${sel === "" ? "selected" : ""}>Any role</option>` +
    roles
      .filter(r => !isSystemAdminRole(r))
      .filter(r => r.is_active || String(r.id) === sel)
      .map(r => `<option value="${r.id}" ${String(r.id) === sel ? "selected" : ""}>${escapeHtml(r.name)}${r.is_active ? "" : " (inactive)"}</option>`)
      .join("");
}

function renderQualityWorkflows() {
  document.querySelector("#quality-workflows-table tbody").innerHTML = qualityWorkflows.map(w => `
    <tr>
      <td><strong>${escapeHtml(w.name)}</strong><br><small>${escapeHtml(w.description || "")}</small></td>
      <td>${escapeHtml((w.steps || []).map(s => s.name).join(" → ") || "No steps")}</td>
      <td>${statusBadge(w.is_active)}</td>
      <td class="num">
        <button class="admin-row-btn" type="button" data-edit-quality-workflow="${w.id}">Edit</button>
        <button class="admin-row-btn admin-row-btn-danger" type="button" data-delete-quality-workflow="${w.id}">Remove</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="4" class="txn-empty">No workflows found.</td></tr>`;
}

function renderQualityRules() {
  document.querySelector("#quality-rules-table tbody").innerHTML = qualityRules.map(rule => {
    const min = Number(rule.min_value || 0).toLocaleString("en-IN");
    const range = rule.max_value == null
      ? `${min} & up`
      : `${min} – under ${Number(rule.max_value).toLocaleString("en-IN")}`;
    return `
      <tr>
        <td>${escapeHtml(rule.nature)}</td>
        <td>${escapeHtml(range)}</td>
        <td>${escapeHtml(rule.initiator_role_name || "Any role")}</td>
        <td>${escapeHtml(rule.workflow_name || "")}</td>
        <td>${statusBadge(rule.is_active)}</td>
        <td class="num">
          <button class="admin-row-btn" type="button" data-edit-quality-rule="${rule.id}">Edit</button>
          <button class="admin-row-btn admin-row-btn-danger" type="button" data-delete-quality-rule="${rule.id}">Remove</button>
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="6" class="txn-empty">No routing rules found.</td></tr>`;
}

function resetQualityWorkflowForm() {
  document.getElementById("quality-workflow-form-title").textContent = "Create Workflow";
  document.getElementById("quality-workflow-id").value = "";
  document.getElementById("quality-workflow-name").value = "";
  document.getElementById("quality-workflow-description").value = "";
  document.getElementById("quality-workflow-active").value = "true";
  renderWorkflowSteps();
}

function resetQualityRuleForm() {
  document.getElementById("quality-rule-form-title").textContent = "Create Rule";
  document.getElementById("quality-rule-id").value = "";
  document.getElementById("quality-rule-nature").value = "Credit Note";
  document.getElementById("quality-rule-min").value = "0";
  document.getElementById("quality-rule-max").value = "";
  document.getElementById("quality-rule-active").value = "true";
  renderQualityWorkflowOptions();
  renderQualityRuleRoleOptions();
}

function renderAdmin() {
  const session = state.session || {};
  document.getElementById("admin-meta-user").textContent = session.displayName || session.username || "Admin";
  document.getElementById("admin-meta-role").textContent = (session.roles || []).map(r => r.name).join(", ") || "Access control";
  document.getElementById("admin-user-count").textContent = activeCount(users);
  document.getElementById("admin-role-count").textContent = activeCount(roles);
  document.getElementById("admin-department-count").textContent = activeCount(departments);
  document.querySelector('[data-admin-tab="users"]').classList.toggle("hidden", !can("users.manage"));
  document.querySelector('[data-admin-tab="roles"]').classList.toggle("hidden", !can("roles.manage"));
  document.querySelector('[data-admin-tab="departments"]').classList.toggle("hidden", !can("departments.manage"));
  document.querySelector('[data-admin-tab="quality"]').classList.toggle("hidden", !can("quality.workflow.manage"));
  const activeTab = document.querySelector(".admin-tab.active");
  if (activeTab?.classList.contains("hidden")) {
    const first = document.querySelector(".admin-tab:not(.hidden)");
    first?.click();
  }
  renderDepartmentOptions(document.getElementById("admin-user-department").value);
  renderRoleChecks(selectedChecks("admin-user-role"));
  renderPermissionChecks(selectedChecks("admin-role-permission"));
  renderUsers();
  renderRoles();
  renderDepartments();
  renderAuditLogs();
  if (can("quality.workflow.manage")) {
    renderQualityWorkflowOptions(document.getElementById("quality-rule-workflow").value);
    renderQualityRuleRoleOptions(document.getElementById("quality-rule-initiator-role").value);
    renderQualityWorkflows();
    renderQualityRules();
  }
}

function resetUserForm() {
  document.getElementById("admin-user-form-title").textContent = "Create User";
  document.getElementById("admin-user-id").value = "";
  document.getElementById("admin-user-username").value = "";
  document.getElementById("admin-user-display").value = "";
  document.getElementById("admin-user-password").value = "";
  document.getElementById("admin-user-active").value = "true";
  renderDepartmentOptions("");
  renderRoleChecks([]);
}

function resetRoleForm() {
  document.getElementById("admin-role-form-title").textContent = "Create Role";
  document.getElementById("admin-role-id").value = "";
  document.getElementById("admin-role-name").value = "";
  document.getElementById("admin-role-description").value = "";
  document.getElementById("admin-role-active").value = "true";
  renderPermissionChecks([]);
}

function resetDepartmentForm() {
  document.getElementById("admin-department-form-title").textContent = "Create Department";
  document.getElementById("admin-department-id").value = "";
  document.getElementById("admin-department-name").value = "";
  document.getElementById("admin-department-active").value = "true";
}

async function refreshAdmin() {
  await loadAdminData();
  renderAdmin();
}

async function deleteQualityWorkflow(workflow) {
  const ok = await showConfirm({
    eyebrow: "Remove workflow",
    title: `Remove "${workflow.name}"?`,
    message: "This deletes the workflow, its steps, and routing rules. Existing tickets stay in history but lose the workflow link.",
    okLabel: "Remove",
    cancelLabel: "Cancel",
    danger: true,
  });
  if (!ok) return;
  try {
    const result = await apiJson(`/api/admin/quality/workflows/${workflow.id}`, { method: "DELETE" });
    loaded = false;
    await refreshAdmin();
    const orphaned = Number(result?.orphanedTickets || 0);
    const detail = orphaned
      ? `"${workflow.name}" deleted — ${orphaned} ticket(s) kept in history without a workflow link`
      : `"${workflow.name}" has been deleted`;
    showToast("Workflow removed", detail, "success");
  } catch (err) {
    showToast("Remove failed", err.message, "error");
  }
}

async function deleteUser(user) {
  const ok = await showConfirm({
    eyebrow: "Remove user",
    title: `Remove "${user.username}"?`,
    message: "The account is deleted. Their raised tickets and audit history are kept but no longer linked to a user.",
    okLabel: "Remove",
    cancelLabel: "Cancel",
    danger: true,
  });
  if (!ok) return;
  try {
    await apiJson(`/api/admin/users/${user.id}`, { method: "DELETE" });
    loaded = false;
    await refreshAdmin();
    showToast("User removed", `"${user.username}" has been deleted`, "success");
  } catch (err) {
    showToast("Remove failed", err.message, "error");
  }
}

async function deleteRole(role) {
  const ok = await showConfirm({
    eyebrow: "Remove role",
    title: `Remove "${role.name}"?`,
    message: "The role is deleted and unassigned from all users. Routing rules using it as initiator must be cleared first.",
    okLabel: "Remove",
    cancelLabel: "Cancel",
    danger: true,
  });
  if (!ok) return;
  try {
    await apiJson(`/api/admin/roles/${role.id}`, { method: "DELETE" });
    loaded = false;
    await refreshAdmin();
    showToast("Role removed", `"${role.name}" has been deleted`, "success");
  } catch (err) {
    showToast("Remove failed", err.message, "error");
  }
}

async function deleteDepartment(dept) {
  const ok = await showConfirm({
    eyebrow: "Remove department",
    title: `Remove "${dept.name}"?`,
    message: "Users, workflow steps and tickets that reference this department keep working but lose the department link.",
    okLabel: "Remove",
    cancelLabel: "Cancel",
    danger: true,
  });
  if (!ok) return;
  try {
    await apiJson(`/api/admin/departments/${dept.id}`, { method: "DELETE" });
    loaded = false;
    await refreshAdmin();
    showToast("Department removed", `"${dept.name}" has been deleted`, "success");
  } catch (err) {
    showToast("Remove failed", err.message, "error");
  }
}

async function deleteQualityRule(rule) {
  const range = rule.max_value == null
    ? `≥ ${Number(rule.min_value || 0).toLocaleString("en-IN")}`
    : `${Number(rule.min_value || 0).toLocaleString("en-IN")}–${Number(rule.max_value).toLocaleString("en-IN")}`;
  const ok = await showConfirm({
    eyebrow: "Remove rule",
    title: `Remove ${rule.nature} rule?`,
    message: `${range} → ${rule.workflow_name || "(no workflow)"}${rule.initiator_role_name ? ` for ${rule.initiator_role_name}` : ""}.`,
    okLabel: "Remove",
    cancelLabel: "Cancel",
    danger: true,
  });
  if (!ok) return;
  try {
    await apiJson(`/api/admin/quality/rules/${rule.id}`, { method: "DELETE" });
    loaded = false;
    await refreshAdmin();
    showToast("Rule removed", "Routing rule has been deleted", "success");
  } catch (err) {
    showToast("Remove failed", err.message, "error");
  }
}

export async function renderAdminPage() {
  if (!can("admin.view")) return;
  if (!loaded) {
    try {
      await loadAdminData();
    } catch (e) {
      showToast("Admin load failed", e.message, "error");
    }
  }
  renderAdmin();
}

export function wireAdmin() {
  document.querySelectorAll(".admin-tab").forEach(tab => {
    tab.addEventListener("click", () => switchAdminTab(tab.dataset.adminTab));
  });
  document.querySelectorAll("[data-admin-jump]").forEach(btn => {
    btn.addEventListener("click", () => switchAdminTab(btn.dataset.adminJump));
  });

  document.getElementById("admin-user-reset").addEventListener("click", resetUserForm);
  document.getElementById("admin-role-reset").addEventListener("click", resetRoleForm);
  document.getElementById("admin-department-reset").addEventListener("click", resetDepartmentForm);
  document.getElementById("quality-workflow-reset")?.addEventListener("click", resetQualityWorkflowForm);
  document.getElementById("quality-rule-reset")?.addEventListener("click", resetQualityRuleForm);
  document.getElementById("quality-step-add")?.addEventListener("click", () => {
    document.getElementById("quality-workflow-steps").insertAdjacentHTML("beforeend", stepRowTemplate());
  });

  document.getElementById("admin-user-form").addEventListener("submit", async e => {
    e.preventDefault();
    const id = document.getElementById("admin-user-id").value;
    const password = document.getElementById("admin-user-password").value;
    const payload = {
      username: document.getElementById("admin-user-username").value,
      displayName: document.getElementById("admin-user-display").value,
      departmentId: document.getElementById("admin-user-department").value || null,
      isActive: boolValue("admin-user-active"),
      roleIds: selectedChecks("admin-user-role"),
    };
    if (!id) payload.password = password;
    try {
      const path = id ? `/api/admin/users/${id}` : "/api/admin/users";
      const method = id ? "PATCH" : "POST";
      await apiJson(path, { method, body: JSON.stringify(payload) });
      if (id && password) {
        await apiJson(`/api/admin/users/${id}/password`, {
          method: "POST",
          body: JSON.stringify({ password }),
        });
      }
      resetUserForm();
      await refreshAdmin();
      showToast("User saved", "Access changes are now active", "success");
    } catch (err) {
      showToast("User save failed", err.message, "error");
    }
  });

  document.getElementById("admin-role-form").addEventListener("submit", async e => {
    e.preventDefault();
    const id = document.getElementById("admin-role-id").value;
    const payload = {
      name: document.getElementById("admin-role-name").value,
      description: document.getElementById("admin-role-description").value,
      isActive: boolValue("admin-role-active"),
      permissions: selectedChecks("admin-role-permission"),
    };
    try {
      await apiJson(id ? `/api/admin/roles/${id}` : "/api/admin/roles", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      resetRoleForm();
      await refreshAdmin();
      switchAdminTab("users");
      showToast("Role saved", "Permission changes are now active", "success");
    } catch (err) {
      showToast("Role save failed", err.message, "error");
    }
  });

  document.getElementById("admin-department-form").addEventListener("submit", async e => {
    e.preventDefault();
    const id = document.getElementById("admin-department-id").value;
    const payload = {
      name: document.getElementById("admin-department-name").value,
      isActive: boolValue("admin-department-active"),
    };
    try {
      await apiJson(id ? `/api/admin/departments/${id}` : "/api/admin/departments", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      resetDepartmentForm();
      await refreshAdmin();
      switchAdminTab("roles");
      showToast("Department saved", "Department list updated", "success");
    } catch (err) {
      showToast("Department save failed", err.message, "error");
    }
  });

  document.getElementById("quality-workflow-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const id = document.getElementById("quality-workflow-id").value;
    const payload = {
      name: document.getElementById("quality-workflow-name").value,
      description: document.getElementById("quality-workflow-description").value,
      isActive: boolValue("quality-workflow-active"),
      steps: readWorkflowSteps(),
    };
    try {
      await apiJson(id ? `/api/admin/quality/workflows/${id}` : "/api/admin/quality/workflows", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      resetQualityWorkflowForm();
      loaded = false;
      await refreshAdmin();
      showToast("Workflow saved", "Quality routing is updated", "success");
    } catch (err) {
      showToast("Workflow save failed", err.message, "error");
    }
  });

  document.getElementById("quality-rule-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const id = document.getElementById("quality-rule-id").value;
    const payload = {
      nature: document.getElementById("quality-rule-nature").value,
      minValue: document.getElementById("quality-rule-min").value,
      maxValue: document.getElementById("quality-rule-max").value,
      workflowId: document.getElementById("quality-rule-workflow").value,
      initiatorRoleId: document.getElementById("quality-rule-initiator-role").value || null,
      isActive: boolValue("quality-rule-active"),
    };
    try {
      await apiJson(id ? `/api/admin/quality/rules/${id}` : "/api/admin/quality/rules", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      resetQualityRuleForm();
      loaded = false;
      await refreshAdmin();
      showToast("Rule saved", "Nature and value routing is updated", "success");
    } catch (err) {
      showToast("Rule save failed", err.message, "error");
    }
  });

  document.getElementById("page-admin").addEventListener("click", e => {
    const userBtn = e.target.closest("[data-edit-user]");
    if (userBtn) {
      const user = users.find(u => String(u.id) === userBtn.dataset.editUser);
      if (!user) return;
      document.getElementById("admin-user-form-title").textContent = `Edit ${user.username}`;
      document.getElementById("admin-user-id").value = user.id;
      document.getElementById("admin-user-username").value = user.username;
      document.getElementById("admin-user-display").value = user.display_name || "";
      document.getElementById("admin-user-password").value = "";
      document.getElementById("admin-user-active").value = String(Boolean(user.is_active));
      renderDepartmentOptions(user.department_id || "");
      renderRoleChecks((user.roles || []).map(r => r.id));
    }

    const roleBtn = e.target.closest("[data-edit-role]");
    if (roleBtn) {
      const role = roles.find(r => String(r.id) === roleBtn.dataset.editRole);
      if (!role) return;
      document.getElementById("admin-role-form-title").textContent = `Edit ${role.name}`;
      document.getElementById("admin-role-id").value = role.id;
      document.getElementById("admin-role-name").value = role.name;
      document.getElementById("admin-role-description").value = role.description || "";
      document.getElementById("admin-role-active").value = String(Boolean(role.is_active));
      renderPermissionChecks(role.permissions || []);
    }

    const deptBtn = e.target.closest("[data-edit-department]");
    if (deptBtn) {
      const dept = departments.find(d => String(d.id) === deptBtn.dataset.editDepartment);
      if (!dept) return;
      document.getElementById("admin-department-form-title").textContent = `Edit ${dept.name}`;
      document.getElementById("admin-department-id").value = dept.id;
      document.getElementById("admin-department-name").value = dept.name;
      document.getElementById("admin-department-active").value = String(Boolean(dept.is_active));
    }

    const removeStepBtn = e.target.closest("[data-remove-quality-step]");
    if (removeStepBtn) {
      removeStepBtn.closest("[data-quality-step]")?.remove();
    }

    const workflowBtn = e.target.closest("[data-edit-quality-workflow]");
    if (workflowBtn) {
      const workflow = qualityWorkflows.find(w => String(w.id) === workflowBtn.dataset.editQualityWorkflow);
      if (!workflow) return;
      document.getElementById("quality-workflow-form-title").textContent = `Edit ${workflow.name}`;
      document.getElementById("quality-workflow-id").value = workflow.id;
      document.getElementById("quality-workflow-name").value = workflow.name;
      document.getElementById("quality-workflow-description").value = workflow.description || "";
      document.getElementById("quality-workflow-active").value = String(Boolean(workflow.is_active));
      renderWorkflowSteps(workflow.steps || []);
    }

    const ruleBtn = e.target.closest("[data-edit-quality-rule]");
    if (ruleBtn) {
      const rule = qualityRules.find(r => String(r.id) === ruleBtn.dataset.editQualityRule);
      if (!rule) return;
      document.getElementById("quality-rule-form-title").textContent = `Edit ${rule.nature} Rule`;
      document.getElementById("quality-rule-id").value = rule.id;
      document.getElementById("quality-rule-nature").value = rule.nature;
      document.getElementById("quality-rule-min").value = rule.min_value || 0;
      document.getElementById("quality-rule-max").value = rule.max_value ?? "";
      document.getElementById("quality-rule-active").value = String(Boolean(rule.is_active));
      renderQualityWorkflowOptions(rule.workflow_id);
      renderQualityRuleRoleOptions(rule.initiator_role_id ?? "");
    }

    const deleteWorkflowBtn = e.target.closest("[data-delete-quality-workflow]");
    if (deleteWorkflowBtn) {
      const workflow = qualityWorkflows.find(w => String(w.id) === deleteWorkflowBtn.dataset.deleteQualityWorkflow);
      if (!workflow) return;
      deleteQualityWorkflow(workflow);
    }

    const deleteRuleBtn = e.target.closest("[data-delete-quality-rule]");
    if (deleteRuleBtn) {
      const rule = qualityRules.find(r => String(r.id) === deleteRuleBtn.dataset.deleteQualityRule);
      if (!rule) return;
      deleteQualityRule(rule);
    }

    const deleteUserBtn = e.target.closest("[data-delete-user]");
    if (deleteUserBtn) {
      const user = users.find(u => String(u.id) === deleteUserBtn.dataset.deleteUser);
      if (user) deleteUser(user);
    }

    const deleteRoleBtn = e.target.closest("[data-delete-role]");
    if (deleteRoleBtn) {
      const role = roles.find(r => String(r.id) === deleteRoleBtn.dataset.deleteRole);
      if (role) deleteRole(role);
    }

    const deleteDeptBtn = e.target.closest("[data-delete-department]");
    if (deleteDeptBtn) {
      const dept = departments.find(d => String(d.id) === deleteDeptBtn.dataset.deleteDepartment);
      if (dept) deleteDepartment(dept);
    }
  });

  resetQualityWorkflowForm();
  resetQualityRuleForm();
}
