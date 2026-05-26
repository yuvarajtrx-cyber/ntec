import { apiJson, can } from "../api.js";
import { escapeHtml } from "../format.js";
import { state } from "../state.js";
import { showToast } from "../toast.js";

let loaded = false;
let users = [];
let roles = [];
let departments = [];
let permissions = [];
let auditLogs = [];

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
    can("roles.manage") || can("users.manage") ? apiJson("/api/admin/roles") : Promise.resolve({ roles: [] }),
    can("departments.manage") || can("users.manage") ? apiJson("/api/admin/departments") : Promise.resolve({ departments: [] }),
    apiJson("/api/admin/audit-log?limit=150"),
  ];
  const [perms, userData, roleData, deptData, auditData] = await Promise.all(requests);
  permissions = perms.permissions || [];
  users = userData.users || [];
  roles = roleData.roles || [];
  departments = deptData.departments || [];
  auditLogs = auditData.logs || [];
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
  document.querySelector("#admin-users-table tbody").innerHTML = users.map(user => `
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
          : `<button class="admin-row-btn" type="button" data-edit-user="${user.id}">Edit</button>`
      }</td>
    </tr>
  `).join("") || `<tr><td colspan="5" class="txn-empty">No users found.</td></tr>`;
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
          : `<button class="admin-row-btn" type="button" data-edit-role="${role.id}">Edit</button>`
      }</td>
    </tr>
  `).join("") || `<tr><td colspan="4" class="txn-empty">No roles found.</td></tr>`;
}

function renderDepartments() {
  document.querySelector("#admin-departments-table tbody").innerHTML = departments.map(dept => `
    <tr>
      <td>${escapeHtml(dept.name)}</td>
      <td>${statusBadge(dept.is_active)}</td>
      <td class="num"><button class="admin-row-btn" type="button" data-edit-department="${dept.id}">Edit</button></td>
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
  });
}
