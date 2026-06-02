// ═══════════════════════════════════════════════════════════
//  ui.js — Interfaz completa: registros, grupos, dashboard
// ═══════════════════════════════════════════════════════════

import { APP } from "./config.js";

// ── Estado global del módulo ─────────────────────────────
let _Auth, _DB;
let _remitos        = [];
let _allRemitos     = [];   // sin filtros cliente (para dropdowns)
let _ctx            = { type: "personal", uid: null };
let _groups         = [];
let _currentGroup   = null; // grupo activo en vista de detalle
let _activeFilters  = {};
let _editingId      = null;
let _deletingId     = null;
let _scanImageB64   = null;
let _activeTab      = "personal"; // "personal" | "grupos" | "dashboard"
let _groupView      = "list";     // "list" | "detail"

// ── Formateadores reutilizables ──────────────────────────
const fmtDate = new Intl.DateTimeFormat(APP.DATE_LOCALE, { day: "2-digit", month: "2-digit", year: "numeric" });
const fmtNum  = new Intl.NumberFormat(APP.DATE_LOCALE,  { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════
export function initUI({ Auth, DB }) {
  _Auth = Auth; _DB = DB;
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  return { mount };
}

function mount() {
  // Auth
  $("#btn-google-login").addEventListener("click", handleLogin);
  $("#btn-logout").addEventListener("click", handleLogout);
  $("#btn-settings").addEventListener("click", openSettings);

  // Tabs
  document.querySelectorAll(".tab-btn").forEach((btn) =>
    btn.addEventListener("click", () => switchTab(btn.dataset.tab))
  );

  // Remitos CRUD
  $("#btn-new").addEventListener("click",       () => openRemitoModal(null));
  $("#btn-new-empty").addEventListener("click", () => openRemitoModal(null));
  $("#btn-save").addEventListener("click",      handleSaveRemito);
  $("#btn-confirm-delete").addEventListener("click", handleConfirmDelete);

  // Scan / Galería
  $("#btn-scan").addEventListener("click",    () => openScanModal("camera"));
  $("#btn-gallery").addEventListener("click", () => openScanModal("gallery"));
  $("#scan-camera").addEventListener("change",        handleScanImageSelected);
  $("#scan-gallery-input").addEventListener("change", handleScanImageSelected);
  $("#btn-analyze").addEventListener("click", handleAnalyze);

  // Filtros
  $("#btn-toggle-advanced").addEventListener("click", toggleAdvancedFilters);
  $("#btn-apply-filters").addEventListener("click",   applyFilters);
  $("#btn-clear-filters").addEventListener("click",   clearFilters);

  // Exportar
  $("#btn-export-pdf").addEventListener("click",   () => exportToPDF(_remitos, currentContextName()));
  $("#btn-export-excel").addEventListener("click", () => exportToExcel(_remitos, currentContextName()));

  // Importar
  $("#btn-import-excel").addEventListener("click",  () => $("#import-file-excel").click());
  $("#btn-import-pdf").addEventListener("click",    () => $("#import-file-pdf").click());
  $("#import-file-excel").addEventListener("change", handleImportExcel);
  $("#import-file-pdf").addEventListener("change",   handleImportPDF);

  // Grupos
  $("#btn-create-group").addEventListener("click",  () => openModal("modal-create-group"));
  $("#btn-save-group").addEventListener("click",    handleCreateGroup);
  $("#btn-back-group").addEventListener("click",    backToGroupList);
  $("#btn-invite-member").addEventListener("click", () => openModal("modal-invite"));
  $("#btn-save-invite").addEventListener("click",   handleInviteMember);
  $("#btn-view-members").addEventListener("click",  openMembersModal);

  // Configuración
  $("#btn-save-settings").addEventListener("click", handleSaveSettings);
  $("#field-ai-provider").addEventListener("change", (e) => updateSettingsHint(e.target.value));
}
}
  // Cerrar modales
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-close]");
    if (t) closeModal(t.dataset.close);
  });

  // Auth observer
  _Auth.onAuthChanged(async (user) => {
    if (user) {
      _ctx = { type: "personal", uid: user.uid };
      showApp(user);
      await loadUserProfile(user);
      startGroupsListener(user.email);
      startDataListener();
    } else {
      showLogin();
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════
async function handleLogin() {
  const btn = $("btn-google-login");
  const err = $("login-error");
  err.textContent = "";
  btn.disabled = true;
  btn.textContent = "Conectando…";
  try {
    await _Auth.loginWithGoogle();
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false;
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 2.9l5.7-5.7C34.5 6.5 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.9z"/></svg> Continuar con Google`;
  }
}

async function handleLogout() {
  _DB.unsubscribeAll();
  _DB.unsubscribeGroups();
  await _Auth.logout();
}

function showApp(user) {
  ge("login-screen").classList.add("hidden");
  ge("app-screen").classList.remove("hidden");
  const avatar = $("user-avatar");
  avatar.src = user.photoURL ?? "";
  avatar.style.display = user.photoURL ? "block" : "none";
  setText("user-name", user.displayName?.split(" ")[0] ?? user.email ?? "");
}

function showLogin() {
  ge("app-screen").classList.add("hidden");
  ge("login-screen").classList.remove("hidden");
  _remitos = []; _allRemitos = []; _groups = []; _activeFilters = {};
  _ctx = { type: "personal", uid: null };
}

async function loadUserProfile(user) {
  const profile = await _DB.getUserProfile(user.uid).catch(() => null);
  if (!profile) {
    // Guardar perfil inicial
    await _DB.saveUserProfile(user.uid, { email: user.email, displayName: user.displayName || "" }).catch(() => {});
  }
  // Mostrar alias en settings
  if (profile?.alias) ge("current-alias").textContent = "@" + profile.alias;
}

// ═══════════════════════════════════════════════════════════
//  TABS
// ═══════════════════════════════════════════════════════════
function switchTab(tab) {
  _activeTab = tab;
  document.querySelectorAll(".tab-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab)
  );
  ge("tab-personal").classList.toggle("hidden", tab !== "personal");
  ge("tab-grupos").classList.toggle("hidden",   tab !== "grupos");
  ge("tab-dashboard").classList.toggle("hidden", tab !== "dashboard");

  if (tab === "dashboard") renderDashboard(_allRemitos);
  if (tab === "grupos")    renderGroupList();
}

// ═══════════════════════════════════════════════════════════
//  DATOS
// ═══════════════════════════════════════════════════════════
function startDataListener(filters = {}) {
  showLoadingState();
  _DB.subscribeRemitos({
    ctx: _ctx,
    filters,
    onData: handleNewData,
    onError: (err) => showToast("Error al cargar datos: " + err.message, "error"),
  });
}

function handleNewData(remitos) {
  _remitos    = remitos;
  _allRemitos = remitos;
  renderTable(remitos);
  renderStats(remitos);
  populateFilterDropdowns(remitos);
  if (_activeTab === "dashboard") renderDashboard(remitos);
}

function startGroupsListener(email) {
  _DB.subscribeUserGroups(email, {
    onData: (groups) => {
      _groups = groups;
      if (_activeTab === "grupos") renderGroupList();
    },
    onError: (err) => console.error("Groups error:", err),
  });
}

function currentContextName() {
  if (_ctx.type === "group") return _currentGroup?.name ?? "Grupo";
  return "Personal";
}

// ═══════════════════════════════════════════════════════════
//  FILTROS
// ═══════════════════════════════════════════════════════════
function toggleAdvancedFilters() {
  const panel = ge("advanced-filters");
  panel.classList.toggle("hidden");
  $("btn-toggle-advanced").textContent = panel.classList.contains("hidden") ? "⚙ Más filtros" : "⚙ Ocultar filtros";
}

function populateFilterDropdowns(remitos) {
  const choferes = [...new Set(remitos.map((r) => r.chofer).filter(Boolean))].sort();
  const origenes = [...new Set(remitos.map((r) => r.desde).filter(Boolean))].sort();
  const destinos = [...new Set(remitos.map((r) => r.hasta).filter(Boolean))].sort();
  fillSelect("filter-chofer",  choferes);
  fillSelect("filter-origen",  origenes);
  fillSelect("filter-destino", destinos);
}

function fillSelect(id, options) {
  const sel = ge(id);
  const current = sel.value;
  sel.innerHTML = '<option value="">Todos</option>';
  options.forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o; opt.textContent = o;
    if (o === current) opt.selected = true;
    sel.appendChild(opt);
  });
}

function applyFilters() {
  const from    = ge("filter-from").value;
  const to      = ge("filter-to").value;
  const chofer  = ge("filter-chofer").value;
  const origen  = ge("filter-origen").value;
  const destino = ge("filter-destino").value;

  // Filtros de fecha -> Firestore; resto -> cliente
  const dateFilters = {};
  if (from) dateFilters.from = from;
  if (to)   dateFilters.to   = to;

  _activeFilters = { from, to, chofer, origen, destino };
  const hasFilter = Object.values(_activeFilters).some(Boolean);
  toggleEl("filter-badge", hasFilter);

  startDataListener(dateFilters);
}

function clearFilters() {
  _activeFilters = {};
  ge("filter-from").value    = "";
  ge("filter-to").value      = "";
  ge("filter-chofer").value  = "";
  ge("filter-origen").value  = "";
  ge("filter-destino").value = "";
  toggleEl("filter-badge", false);
  startDataListener();
}

function applyClientFilters(remitos) {
  return remitos.filter((r) => {
    if (_activeFilters.chofer  && r.chofer !== _activeFilters.chofer)  return false;
    if (_activeFilters.origen  && r.desde  !== _activeFilters.origen)  return false;
    if (_activeFilters.destino && r.hasta  !== _activeFilters.destino) return false;
    return true;
  });
}

// ═══════════════════════════════════════════════════════════
//  TABLA
// ═══════════════════════════════════════════════════════════
function showLoadingState() {
  toggleEl("loading-state", true);
  toggleEl("empty-state",   false);
  toggleEl("table-wrapper", false);
}

function renderTable(remitos) {
  toggleEl("loading-state", false);
  const filtered = applyClientFilters(remitos);

  if (!filtered.length) {
    toggleEl("empty-state",   true);
    toggleEl("table-wrapper", false);
    return;
  }
  toggleEl("empty-state",   false);
  toggleEl("table-wrapper", true);

  const tbody = ge("remitos-body");
  tbody.innerHTML = filtered.map(renderRow).join("");

  tbody.querySelectorAll("[data-action='edit']").forEach((btn) =>
    btn.addEventListener("click", () => openRemitoModal(_remitos.find((r) => r.id === btn.dataset.id)))
  );
  tbody.querySelectorAll("[data-action='delete']").forEach((btn) =>
    btn.addEventListener("click", () => openDeleteModal(btn.dataset.id, btn.dataset.num))
  );
}

function renderRow(r) {
  const fechaStr = r.fecha instanceof Date && !isNaN(r.fecha) ? fmtDate.format(r.fecha) : "—";
  return `<tr>
    <td><span class="cell-numero">${esc(r.numeroRemito) || "—"}</span></td>
    <td class="cell-date">${fechaStr}</td>
    <td>${esc(r.chofer) || "—"}</td>
    <td><span class="tag tag-from">${esc(r.desde) || "—"}</span></td>
    <td><span class="tag tag-to">${esc(r.hasta) || "—"}</span></td>
    <td class="cell-litros">${fmtNum.format(r.cantidadLitros)}</td>
    <td class="col-actions">
      <div class="row-actions">
        <button class="btn-row btn-row-edit"   data-action="edit"   data-id="${r.id}" aria-label="Editar">✏️</button>
        <button class="btn-row btn-row-delete" data-action="delete" data-id="${r.id}" data-num="${esc(r.numeroRemito)}" aria-label="Eliminar">🗑️</button>
      </div>
    </td>
  </tr>`;
}

function renderStats(remitos) {
  const filtered     = applyClientFilters(remitos);
  const totalLitros  = filtered.reduce((a, r) => a + (r.cantidadLitros || 0), 0);
  setText("stat-count",  filtered.length.toString());
  setText("stat-litros", fmtNum.format(totalLitros) + " L");
}

// ═══════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════
function renderDashboard(remitos) {
  if (!remitos.length) {
    toggleEl("dashboard-empty",   true);
    toggleEl("dashboard-content", false);
    return;
  }
  toggleEl("dashboard-empty",   false);
  toggleEl("dashboard-content", true);

  const totalLitros = remitos.reduce((a, r) => a + (r.cantidadLitros || 0), 0);
  const choferes    = [...new Set(remitos.map((r) => r.chofer).filter(Boolean))];
  const origenes    = [...new Set(remitos.map((r) => r.desde).filter(Boolean))];

  setText("dash-total-remitos",  remitos.length.toString());
  setText("dash-total-litros",   fmtNum.format(totalLitros) + " L");
  setText("dash-total-choferes", choferes.length.toString());
  setText("dash-total-origenes", origenes.length.toString());

  // Litros por chofer
  renderBarChart("chart-choferes", groupBy(remitos, "chofer"), "primary");
  // Litros por origen
  renderBarChart("chart-origenes", groupBy(remitos, "desde"), "secondary");
  // Litros por destino
  renderBarChart("chart-destinos", groupBy(remitos, "hasta"), "tertiary");
}

function groupBy(remitos, field) {
  const map = {};
  remitos.forEach((r) => {
    const key = r[field] || "Sin especificar";
    map[key] = (map[key] || 0) + (r.cantidadLitros || 0);
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8);
}

function renderBarChart(containerId, entries, colorClass) {
  if (!entries.length) { ge(containerId).innerHTML = '<p class="chart-empty">Sin datos</p>'; return; }
  const max = entries[0][1];
  ge(containerId).innerHTML = entries.map(([label, value]) => `
    <div class="chart-row">
      <div class="chart-row-header">
        <span class="chart-label" title="${esc(label)}">${esc(label)}</span>
        <span class="chart-value">${fmtNum.format(value)} L</span>
      </div>
      <div class="chart-bar-track">
        <div class="chart-bar-fill ${colorClass}" style="width:${Math.round(value/max*100)}%"></div>
      </div>
    </div>`).join("");
}

// ═══════════════════════════════════════════════════════════
//  GRUPOS
// ═══════════════════════════════════════════════════════════
function renderGroupList() {
  const container = ge("group-list");
  if (!_groups.length) {
    container.innerHTML = `<div class="state-view">
      <span class="state-icon">👥</span>
      <p>No pertenecés a ningún grupo todavía.</p>
      <p style="font-size:.85rem;color:var(--color-text-2)">Creá uno o pedí que te inviten.</p>
    </div>`;
    return;
  }
  container.innerHTML = _groups.map((g) => `
    <div class="group-card">
      <div class="group-card-info">
        <div class="group-card-name">${esc(g.name)}</div>
        <div class="group-card-meta">${g.memberEmails?.length ?? 1} miembro(s)</div>
      </div>
      <button class="btn btn-primary btn-sm group-enter-btn" data-group-id="${g.id}" data-group-name="${esc(g.name)}">
        Entrar →
      </button>
    </div>`).join("");

  container.querySelectorAll(".group-enter-btn").forEach((btn) =>
    btn.addEventListener("click", () => enterGroup(btn.dataset.groupId, btn.dataset.groupName))
  );
}

function enterGroup(groupId, groupName) {
  _currentGroup = _groups.find((g) => g.id === groupId) || { id: groupId, name: groupName };
  _ctx          = { type: "group", groupId };
  _groupView    = "detail";
  _activeFilters = {};

  // Mostrar vista de detalle del grupo
  ge("group-list-view").classList.add("hidden");
  ge("group-detail-view").classList.remove("hidden");
  setText("group-detail-name", groupName);

  // Actualizar label de stats según el contexto
  startDataListener();
}

function backToGroupList() {
  _groupView     = "list";
  _currentGroup  = null;
  _activeFilters = {};
  _DB.unsubscribeAll();

  ge("group-detail-view").classList.add("hidden");
  ge("group-list-view").classList.remove("hidden");

  // Volver al contexto personal
  _ctx = { type: "personal", uid: _Auth.currentUser()?.uid };
}

async function handleCreateGroup() {
  const name = ge("field-group-name").value.trim();
  if (!name) { showToast("Poné un nombre para el grupo.", "info"); return; }

  const btn = $("btn-save-group");
  btn.disabled = true; btn.textContent = "Creando…";
  try {
    const user    = _Auth.currentUser();
    const profile = await _DB.getUserProfile(user.uid).catch(() => null);
    await _DB.createGroup({
      name,
      creatorUid:   user.uid,
      creatorEmail: user.email,
      creatorAlias: profile?.alias || "",
    });
    ge("field-group-name").value = "";
    closeModal("modal-create-group");
    showToast(`Grupo "${name}" creado ✓`, "success");
  } catch (err) {
    showToast("Error al crear el grupo: " + err.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Crear grupo";
  }
}

async function handleInviteMember() {
  if (!_currentGroup) return;
  const input = ge("field-invite").value.trim();
  if (!input) { showToast("Ingresá un email o alias.", "info"); return; }

  const btn = $("btn-save-invite");
  btn.disabled = true; btn.textContent = "Invitando…";
  try {
    const email = await _DB.resolveInvite(input);
    if (!email) { showToast("No se encontró ningún usuario con ese alias.", "error"); return; }
    await _DB.inviteMember(_currentGroup.id, email);
    ge("field-invite").value = "";
    closeModal("modal-invite");
    showToast(`${email} invitado/a al grupo ✓`, "success");
  } catch (err) {
    showToast("Error al invitar: " + err.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Invitar";
  }
}

function openMembersModal() {
  if (!_currentGroup) return;
  const members = _currentGroup.memberEmails || [];
  ge("members-list").innerHTML = members.map((email) => `
    <div class="member-row">
      <span class="member-email">📧 ${esc(email)}</span>
      ${email !== _Auth.currentUser()?.email ? `<button class="btn btn-ghost btn-xs member-remove-btn" data-email="${esc(email)}">Quitar</button>` : '<span class="member-you">Vos</span>'}
    </div>`).join("");

  ge("members-list").querySelectorAll(".member-remove-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm(`¿Quitás a ${btn.dataset.email} del grupo?`)) return;
      await _DB.removeMember(_currentGroup.id, btn.dataset.email).catch(() => {});
      showToast("Miembro eliminado.", "success");
      closeModal("modal-members");
    })
  );
  openModal("modal-members");
}

// ═══════════════════════════════════════════════════════════
//  MODAL: NUEVO / EDITAR REMITO
// ═══════════════════════════════════════════════════════════
function openRemitoModal(remito = null) {
  _editingId = remito?.id ?? null;
  setText("modal-remito-title", remito ? "Editar Remito" : "Nuevo Remito");
  ge("form-error").textContent = "";

  if (remito) {
    ge("field-numero").value = remito.numeroRemito ?? "";
    ge("field-chofer").value = remito.chofer       ?? "";
    ge("field-desde").value  = remito.desde        ?? "";
    ge("field-hasta").value  = remito.hasta        ?? "";
    ge("field-litros").value = remito.cantidadLitros ?? "";
    ge("field-fecha").value  = remito.fecha instanceof Date ? remito.fecha.toISOString().slice(0, 10) : "";
  } else {
    ["field-numero","field-chofer","field-desde","field-hasta","field-litros"].forEach((id) => ge(id).value = "");
    ge("field-fecha").value = todayISO();
  }
  openModal("modal-remito");
  setTimeout(() => ge("field-numero").focus(), 300);
}

async function handleSaveRemito() {
  const btn   = $("btn-save");
  const errEl = ge("form-error");
  errEl.textContent = "";

  const data = {
    numeroRemito:   ge("field-numero").value.trim(),
    chofer:         ge("field-chofer").value.trim(),
    desde:          ge("field-desde").value.trim(),
    hasta:          ge("field-hasta").value.trim(),
    cantidadLitros: ge("field-litros").value,
    fecha:          ge("field-fecha").value,
  };

  const errors = validateRemito(data);
  if (errors.length) { errEl.textContent = errors[0]; return; }

  btn.disabled = true; btn.textContent = "Guardando…";
  try {
    if (_editingId) {
      await _DB.updateRemito(_editingId, data, _ctx);
      showToast("Remito actualizado ✓", "success");
    } else {
      await _DB.addRemito(data, _ctx);
      showToast("Remito guardado ✓", "success");
    }
    closeModal("modal-remito");
  } catch (err) {
    errEl.textContent = "Error al guardar: " + err.message;
  } finally {
    btn.disabled = false; btn.textContent = "Guardar";
  }
}

function validateRemito(data) {
  const e = [];
  if (!data.fecha)  e.push("La fecha es obligatoria.");
  if (!data.chofer) e.push("El nombre del chofer es obligatorio.");
  if (!data.desde)  e.push("La bodega de origen es obligatoria.");
  if (!data.hasta)  e.push("La bodega de destino es obligatoria.");
  if (isNaN(parseFloat(data.cantidadLitros))) e.push("Los litros deben ser un número válido.");
  return e;
}

// ═══════════════════════════════════════════════════════════
//  MODAL: ELIMINAR
// ═══════════════════════════════════════════════════════════
function openDeleteModal(id, numero) {
  _deletingId = id;
  setText("delete-remito-num", numero || "sin número");
  openModal("modal-delete");
}

async function handleConfirmDelete() {
  if (!_deletingId) return;
  const btn = $("btn-confirm-delete");
  btn.disabled = true; btn.textContent = "Eliminando…";
  try {
    await _DB.deleteRemito(_deletingId, _ctx);
    showToast("Remito eliminado.", "success");
    closeModal("modal-delete");
  } catch (err) {
    showToast("Error al eliminar: " + err.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Eliminar";
    _deletingId  = null;
  }
}

// ═══════════════════════════════════════════════════════════
//  CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════
const AI_PROVIDERS = {
  gemini: { placeholder: "AIza…",    hint: 'Gratis en <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com</a>' },
  claude: { placeholder: "sk-ant-…", hint: 'En <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>' },
  openai: { placeholder: "sk-…",     hint: 'En <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a>' },
};

async function openSettings() {
  const user    = _Auth.currentUser();
  const profile = user ? await _DB.getUserProfile(user.uid).catch(() => null) : null;
  ge("field-alias").value       = profile?.alias || "";
  ge("field-ai-provider").value = localStorage.getItem("remitos_ai_provider") || "gemini";
  ge("field-ai-key").value      = localStorage.getItem("remitos_ai_key") || "";
  updateSettingsHint(ge("field-ai-provider").value);
  openModal("modal-settings");
}

function updateSettingsHint(provider) {
  const info = AI_PROVIDERS[provider] || AI_PROVIDERS.gemini;
  ge("field-ai-key").placeholder = info.placeholder;
  ge("settings-hint").innerHTML  = info.hint;
}

async function handleSaveSettings() {
  const alias    = ge("field-alias").value.trim().toLowerCase().replace(/\s/g, "");
  const provider = ge("field-ai-provider").value;
  const key      = ge("field-ai-key").value.trim();

  const user = _Auth.currentUser();
  if (user && alias) {
    await _DB.saveUserProfile(user.uid, { alias, email: user.email, displayName: user.displayName || "" }).catch(() => {});
    ge("current-alias").textContent = "@" + alias;
  }
  if (key) {
    localStorage.setItem("remitos_ai_provider", provider);
    localStorage.setItem("remitos_ai_key", key);
  } else {
    localStorage.removeItem("remitos_ai_provider");
    localStorage.removeItem("remitos_ai_key");
  }
  closeModal("modal-settings");
  showToast("Configuración guardada ✓", "success");
}

// ═══════════════════════════════════════════════════════════
//  OCR — ESCANEO
// ═══════════════════════════════════════════════════════════
function openScanModal(source) {
  resetScanModal();
  openModal("modal-scan");
  // Abrir el input correcto automáticamente
  if (source === "camera")  setTimeout(() => ge("scan-camera").click(), 200);
  if (source === "gallery") setTimeout(() => ge("scan-gallery-input").click(), 200);
}

function handleScanImageSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  const preview  = ge("scan-preview");
  const errEl    = ge("scan-error");
  errEl.textContent = "";
  ge("scan-result-msg").classList.add("hidden");

  const reader = new FileReader();
  reader.onload = (ev) => {
    _scanImageB64 = ev.target.result;
    preview.src   = _scanImageB64;
    preview.classList.remove("hidden");
    $("btn-analyze").disabled = false;
  };
  reader.readAsDataURL(file);
}

async function handleAnalyze() {
  const aiKey      = localStorage.getItem("remitos_ai_key");
  const aiProvider = localStorage.getItem("remitos_ai_provider") || "gemini";
  if (!aiKey) { toggleEl("ai-key-warning", true); return; }
  toggleEl("ai-key-warning", false);

  const statusEl   = ge("scan-status");
  const analyzeBtn = $("btn-analyze");
  const errEl      = ge("scan-error");
  errEl.textContent = "";
  ge("scan-result-msg").classList.add("hidden");
  statusEl.classList.remove("hidden");
  analyzeBtn.disabled = true;

  try {
    // Optimizar imagen antes de enviar (reduce costo de tokens)
    const optimized = await optimizeImage(_scanImageB64, 1024);
    const extracted = await callOCR(aiProvider, aiKey, optimized);

    closeModal("modal-scan");
    openRemitoModal(null);
    if (extracted.numeroRemito)   ge("field-numero").value = extracted.numeroRemito;
    if (extracted.fecha)          ge("field-fecha").value  = extracted.fecha;
    if (extracted.chofer)         ge("field-chofer").value = extracted.chofer;
    if (extracted.desde)          ge("field-desde").value  = extracted.desde;
    if (extracted.hasta)          ge("field-hasta").value  = extracted.hasta;
    if (extracted.cantidadLitros) ge("field-litros").value = extracted.cantidadLitros;
    showToast("Datos extraídos. Revisá y guardá.", "success");
  } catch (err) {
    console.error("OCR error:", err);
    errEl.textContent = "Error al analizar: " + err.message;
  } finally {
    statusEl.classList.add("hidden");
    analyzeBtn.disabled = false;
  }
}

/** Redimensiona la imagen al máximo indicado y la convierte a JPEG 82% */
async function optimizeImage(dataUrl, maxSize) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        if (width > height) { height = Math.round(height * maxSize / width); width = maxSize; }
        else                { width  = Math.round(width  * maxSize / height); height = maxSize; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.src = dataUrl;
  });
}

// ── OCR multi-proveedor ──────────────────────────────────
const OCR_PROMPT = `Analizá esta imagen de un remito de transporte de líquidos.
Respondé ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin markdown.
Campos:
- "numeroRemito": código del remito. Si no se ve, vacío.
- "fecha": en formato "YYYY-MM-DD". Si no se ve, vacío.
- "chofer": nombre completo, en la esquina inferior izquierda SOBRE la línea "FIRMA DEL CONDUCTOR".
- "desde": texto a la derecha de "DESDE". Bodega origen.
- "hasta": texto a la derecha de "HASTA". Bodega destino.
- "cantidadLitros": número bajo "Total Litros" o mayor valor en columna "Litros". Solo número (ej: 15000.5). Si no, 0.
Formato (SOLO esto): {"numeroRemito":"","fecha":"","chofer":"","desde":"","hasta":"","cantidadLitros":0}`;

async function callOCR(provider, apiKey, imageDataUrl) {
  const [header, base64Data] = imageDataUrl.split(",");
  const mediaType = header.match(/data:([^;]+)/)[1];
  if (provider === "gemini") return callGeminiOCR(apiKey, base64Data, mediaType);
  if (provider === "claude") return callClaudeOCR(apiKey, base64Data, mediaType);
  if (provider === "openai") return callOpenAIOCR(apiKey, base64Data, mediaType);
  throw new Error("Proveedor desconocido: " + provider);
}

function parseOCRResponse(text) {
  const clean = text.replace(/```json|```/gi, "").trim();
  try { return JSON.parse(clean); }
  catch { throw new Error("La IA no devolvió un JSON válido. Intentá con una imagen más clara."); }
}

async function callGeminiOCR(apiKey, base64Data, mediaType) {
  const url  = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: mediaType, data: base64Data } },
        { text: OCR_PROMPT },
      ]}],
      generationConfig: { maxOutputTokens: 400, temperature: 0.1 },
    }),
  });
  if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e?.error?.message ?? `Gemini HTTP ${resp.status}`); }
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.filter((p) => p.text)?.map((p) => p.text)?.join("") ?? "";
  return parseOCRResponse(text);
}

async function callClaudeOCR(apiKey, base64Data, mediaType) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 400, messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
      { type: "text",  text: OCR_PROMPT },
    ]}]}),
  });
  if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e?.error?.message ?? `Claude HTTP ${resp.status}`); }
  const data = await resp.json();
  return parseOCRResponse(data.content?.filter((b) => b.type === "text").map((b) => b.text).join("") ?? "");
}

async function callOpenAIOCR(apiKey, base64Data, mediaType) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-4o", max_tokens: 400, messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64Data}`, detail: "high" } },
      { type: "text",      text: OCR_PROMPT },
    ]}]}),
  });
  if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e?.error?.message ?? `OpenAI HTTP ${resp.status}`); }
  const data = await resp.json();
  return parseOCRResponse(data.choices?.[0]?.message?.content ?? "");
}

// ═══════════════════════════════════════════════════════════
//  IMPORTACIÓN — PDF (con soporte ##RD## y PDF.js)
// ═══════════════════════════════════════════════════════════
async function handleImportPDF(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;

  showToast("Leyendo PDF…", "info", 2000);
  try {
    const text      = await extractPDFText(file);
    const rdRecords = extractRDData(text);

    if (rdRecords && rdRecords.length) {
      // Formato nativo RemitOS — importación directa sin IA
      let count = 0;
      for (const r of rdRecords) {
        const mapped = mapRDRecord(r);
        if (mapped.chofer || mapped.desde || mapped.cantidadLitros) {
          await _DB.addRemito(mapped, _ctx);
          count++;
        }
      }
      showToast(`${count} remito(s) importado(s) desde PDF ✓`, "success");
    } else {
      showToast("Este PDF no tiene datos embebidos reconocibles. Solo se admiten PDFs exportados desde RemitOS.", "info", 5000);
    }
  } catch (err) {
    console.error("PDF import error:", err);
    showToast("Error al leer el PDF: " + err.message, "error");
  }
}

async function extractPDFText(file) {
  if (!window.pdfjsLib) throw new Error("PDF.js no está disponible.");
  const arrayBuffer = await file.arrayBuffer();
  const pdf         = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(" ") + "\n";
  }
  return text;
}

/** Extrae los chunks ##RD{n}## y decodifica el base64 acumulado */
function extractRDData(text) {
  const parts = [];
  const regex = /##RD\d+##([A-Za-z0-9+/=\s]+?)(?=##RD|$)/g;
  let m;
  while ((m = regex.exec(text)) !== null) parts.push(m[1].replace(/\s/g, ""));
  if (!parts.length) return null;
  try {
    const parsed = JSON.parse(atob(parts.join("")));
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

/** Mapea los campos del formato RemitOS a los campos de la app */
function mapRDRecord(r) {
  return {
    numeroRemito:   String(r.numero_remito || r.numeroRemito || "").trim(),
    fecha:          parseDateStr(r.fecha || ""),
    chofer:         String(r.nombre_chofer || r.chofer || "").trim(),
    desde:          String(r.bodega_origen || r.desde  || "").trim(),
    hasta:          String(r.bodega_destino || r.hasta || "").trim(),
    cantidadLitros: parseFloat(r.litros || r.cantidadLitros || 0),
  };
}

function parseDateStr(str) {
  if (!str) return todayISO();
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(str);
  return isNaN(d) ? todayISO() : d.toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════
//  IMPORTACIÓN — EXCEL / CSV
// ═══════════════════════════════════════════════════════════
async function handleImportExcel(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = await file.arrayBuffer();
    const wb   = XLSX.read(data, { type: "array", cellDates: true });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (rows.length < 2) { showToast("El archivo no tiene datos.", "info"); return; }

    const headerRow = rows[0].map((h) => String(h).toLowerCase().trim());
    const col       = buildColumnIndex(headerRow);
    const toImport  = [];

    for (let i = 1; i < rows.length; i++) {
      const row    = rows[i];
      const litros = parseFloat(row[col.litros]) || 0;
      if (!row[col.chofer] && !row[col.desde] && litros === 0) continue;
      toImport.push({
        numeroRemito:   String(row[col.numero] ?? "").trim(),
        fecha:          parseExcelDate(row[col.fecha]),
        chofer:         String(row[col.chofer] ?? "").trim(),
        desde:          String(row[col.desde]  ?? "").trim(),
        hasta:          String(row[col.hasta]  ?? "").trim(),
        cantidadLitros: litros,
      });
    }

    if (!toImport.length) { showToast("No se encontraron remitos válidos.", "info"); return; }
    let count = 0;
    for (const remito of toImport) { await _DB.addRemito(remito, _ctx); count++; }
    showToast(`${count} remito(s) importado(s) ✓`, "success");
  } catch (err) {
    showToast("Error al importar: " + err.message, "error");
  }
}

function buildColumnIndex(headerRow) {
  const find = (...kw) => { for (const k of kw) { const i = headerRow.findIndex((h) => h.includes(k)); if (i !== -1) return i; } return -1; };
  return {
    numero: find("n°", "numero", "remito", "nro"),
    fecha:  find("fecha", "date"),
    chofer: find("chofer", "conductor", "transportista"),
    desde:  find("desde", "origen"),
    hasta:  find("hasta", "destino"),
    litros: find("litros", "cantidad", "total"),
  };
}

function parseExcelDate(raw) {
  if (!raw) return todayISO();
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (typeof raw === "number") return new Date(Math.round((raw - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
  const d = new Date(raw);
  return isNaN(d) ? todayISO() : d.toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════
//  EXPORTACIÓN — PDF
// ═══════════════════════════════════════════════════════════
function exportToPDF(remitos, contextName) {
  const filtered = applyClientFilters(remitos);
  if (!filtered.length) { showToast("No hay datos para exportar.", "info"); return; }
  const { jsPDF } = window.jspdf;
  const docPDF    = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  docPDF.setFontSize(16); docPDF.setFont("helvetica", "bold");
  docPDF.text(`${APP.EXPORT_TITLE} — ${contextName}`, 14, 16);
  docPDF.setFontSize(9);  docPDF.setFont("helvetica", "normal"); docPDF.setTextColor(120);
  docPDF.text(`Generado: ${fmtDate.format(new Date())} | Total: ${filtered.length} remitos`, 14, 23);

  // Datos embebidos para re-importación
  const rdData   = JSON.stringify(filtered.map((r) => ({
    numero_remito: r.numeroRemito, fecha: fmtDate.format(r.fecha),
    litros: r.cantidadLitros, bodega_origen: r.desde, bodega_destino: r.hasta, nombre_chofer: r.chofer,
  })));
  const b64      = btoa(unescape(encodeURIComponent(rdData)));
  const chunkSz  = 200;
  let rdChunks   = "";
  for (let i = 0; i < b64.length; i += chunkSz) rdChunks += `##RD${i}##${b64.slice(i, i + chunkSz)}`;

  docPDF.autoTable({
    startY: 28,
    head: [["N° Remito", "Fecha", "Chofer", "Desde", "Hasta", "Litros"]],
    body: filtered.map((r) => [
      r.numeroRemito || "—",
      r.fecha instanceof Date ? fmtDate.format(r.fecha) : "—",
      r.chofer || "—", r.desde || "—", r.hasta || "—",
      fmtNum.format(r.cantidadLitros),
    ]),
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [30, 35, 55], textColor: [245, 158, 11], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [240, 242, 248] },
    columnStyles: { 5: { halign: "right" } },
  });

  const finalY   = docPDF.lastAutoTable.finalY + 6;
  const total    = filtered.reduce((a, r) => a + (r.cantidadLitros || 0), 0);
  docPDF.setFontSize(10); docPDF.setFont("helvetica", "bold"); docPDF.setTextColor(0);
  docPDF.text(`Total Litros: ${fmtNum.format(total)} L`, 14, finalY);

  // Insertar datos embebidos (invisibles, para re-importación)
  docPDF.setFontSize(1); docPDF.setTextColor(255);
  docPDF.text(rdChunks, 14, finalY + 5);

  docPDF.save(`remitos_${contextName}_${todayISO()}.pdf`);
  showToast("PDF generado ✓", "success");
}

// ═══════════════════════════════════════════════════════════
//  EXPORTACIÓN — EXCEL
// ═══════════════════════════════════════════════════════════
function exportToExcel(remitos, contextName) {
  const filtered = applyClientFilters(remitos);
  if (!filtered.length) { showToast("No hay datos para exportar.", "info"); return; }
  const headers = ["N° Remito", "Fecha", "Chofer", "Desde", "Hasta", "Litros"];
  const rows    = filtered.map((r) => [
    r.numeroRemito || "",
    r.fecha instanceof Date ? fmtDate.format(r.fecha) : "",
    r.chofer || "", r.desde || "", r.hasta || "",
    r.cantidadLitros ?? 0,
  ]);
  rows.push(["", "", "", "", "TOTAL LITROS", filtered.reduce((a, r) => a + (r.cantidadLitros || 0), 0)]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws["!cols"] = [14, 12, 22, 20, 20, 12].map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Remitos");
  XLSX.writeFile(wb, `remitos_${contextName}_${todayISO()}.xlsx`);
  showToast("Excel generado ✓", "success");
}

// ═══════════════════════════════════════════════════════════
//  MODALES
// ═══════════════════════════════════════════════════════════
function openModal(id)  { ge(id).classList.add("is-open");    document.body.style.overflow = "hidden"; }
function closeModal(id) { ge(id).classList.remove("is-open"); document.body.style.overflow = "";
  if (id === "modal-scan") resetScanModal();
}

function resetScanModal() {
  _scanImageB64 = null;
  const preview = ge("scan-preview");
  preview.src   = "";
  preview.classList.add("hidden");
  ge("scan-status").classList.add("hidden");
  ge("scan-result-msg").classList.add("hidden");
  ge("scan-error").textContent  = "";
  ge("ai-key-warning").classList.add("hidden");
  $("btn-analyze").disabled     = true;
  ge("scan-camera").value        = "";
  ge("scan-gallery-input").value = "";
}

// ═══════════════════════════════════════════════════════════
//  TOASTS
// ═══════════════════════════════════════════════════════════
export function showToast(message, type = "info", duration = 3500) {
  const container = ge("toast-container");
  const toast     = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = ({ success: "✓", error: "✕", info: "ℹ" }[type] || "") + "  " + message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("is-hiding");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  }, duration);
}

// ═══════════════════════════════════════════════════════════
//  UTILIDADES
// ═══════════════════════════════════════════════════════════
const ge  = (id)  => document.getElementById(id);
const $   = (sel) => document.querySelector(sel);
const esc = (s)   => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const todayISO = () => new Date().toISOString().slice(0, 10);
function setText(id, val)       { const el = ge(id); if (el) el.textContent = val; }
function toggleEl(id, show)     { const el = ge(id); if (el) el.classList.toggle("hidden", !show); }
