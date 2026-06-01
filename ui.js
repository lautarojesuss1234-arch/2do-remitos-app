// ═══════════════════════════════════════════════════════════
//  ui.js — Renderizado, modales, exportación e importación
// ═══════════════════════════════════════════════════════════

import { APP } from "./config.js";

// ── Estado local del módulo ─────────────────────────────
let _DB, _Auth;
let _remitos       = [];   // cache de todos los remitos actuales
let _editingId     = null; // ID del remito que se está editando (null = nuevo)
let _deletingId    = null; // ID del remito que se está eliminando
let _scanImageB64  = null; // Base64 de la imagen a escanear
let _activeFilters = {};   // Filtros de fecha activos

// ── Formateadores (reutilizables, sin recrear cada render) ─
const fmtDate = new Intl.DateTimeFormat(APP.DATE_LOCALE, {
  day:   "2-digit",
  month: "2-digit",
  year:  "numeric",
});
const fmtNum = new Intl.NumberFormat(APP.DATE_LOCALE, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

// ═══════════════════════════════════════════════════════════
//  INIT PÚBLICO
// ═══════════════════════════════════════════════════════════

/**
 * Inicializa la UI conectando los módulos Auth y DB.
 * Devuelve { mount } para montar el árbol de eventos.
 */
export function initUI({ Auth, DB }) {
  _Auth = Auth;
  _DB   = DB;
  return { mount };
}

// ═══════════════════════════════════════════════════════════
//  MOUNT — registro de todos los event listeners
// ═══════════════════════════════════════════════════════════

function mount() {
  // ── Login / Logout ──────────────────────────────────────
  $("#btn-google-login").addEventListener("click", handleLogin);
  $("#btn-logout").addEventListener("click", handleLogout);
  $("#btn-settings").addEventListener("click", () => openSettings());

  // ── Toolbar principal ───────────────────────────────────
  $("#btn-new").addEventListener("click",       () => openRemitoModal(null));
  $("#btn-new-empty").addEventListener("click", () => openRemitoModal(null));
  $("#btn-filter").addEventListener("click",    applyFilters);
  $("#btn-clear-filter").addEventListener("click", clearFilters);

  // ── Guardar remito ──────────────────────────────────────
  $("#btn-save").addEventListener("click", handleSaveRemito);

  // ── Eliminación ─────────────────────────────────────────
  $("#btn-confirm-delete").addEventListener("click", handleConfirmDelete);

  // ── Exportación ─────────────────────────────────────────
  $("#btn-export-pdf").addEventListener("click",   () => exportToPDF(_remitos));
  $("#btn-export-excel").addEventListener("click", () => exportToExcel(_remitos));

  // ── Importación ─────────────────────────────────────────
  $("#btn-import").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", handleImport);

  // ── Escaneo OCR ─────────────────────────────────────────
  $("#btn-scan").addEventListener("click",    () => openModal("modal-scan"));
  $("#scan-image").addEventListener("change", handleScanImageSelected);
  $("#btn-analyze").addEventListener("click", handleAnalyze);

  // ── Configuración IA ────────────────────────────────────
  $("#btn-save-settings").addEventListener("click", handleSaveSettings);

  // ── Cerrar modales (backdrop y botones data-close) ──────
  document.addEventListener("click", (e) => {
    const target = e.target.closest("[data-close]");
    if (target) closeModal(target.dataset.close);
  });

  // ── Auth state observer ─────────────────────────────────
  _Auth.onAuthChanged((user) => {
    if (user) {
      showApp(user);
      startDataListener();
    } else {
      showLogin();
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  AUTENTICACIÓN
// ═══════════════════════════════════════════════════════════

async function handleLogin() {
  const btn = $("#btn-google-login");
  const err = $("#login-error");
  err.textContent = "";
  btn.disabled = true;
  btn.textContent = "Conectando…";

  try {
    await _Auth.loginWithGoogle();
    // El observer onAuthChanged se encarga del resto
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 48 48">
        <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 2.9l5.7-5.7C34.5 6.5 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.9z"/>
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 16.1 19 13 24 13c3.1 0 5.8 1.1 8 2.9l5.7-5.7C34.5 6.5 29.6 4 24 4 16.3 4 9.7 8.4 6.3 14.7z"/>
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.3 26.8 36 24 36c-5.2 0-9.6-3.3-11.3-8H6.3C9.6 35.5 16.3 44 24 44z"/>
        <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.3 4.1-4.2 5.4l.1.1 6.2 5.2C37.1 38 44 33 44 24c0-1.3-.1-2.7-.4-3.9z"/>
      </svg>
      Continuar con Google`;
  }
}

async function handleLogout() {
  _DB.unsubscribeAll();
  await _Auth.logout();
}

function showApp(user) {
  $("#login-screen").classList.add("hidden");
  $("#app-screen").classList.remove("hidden");
  // Mostrar datos del usuario
  const avatar = $("#user-avatar");
  avatar.src = user.photoURL ?? "";
  avatar.style.display = user.photoURL ? "block" : "none";
  setText("#user-name", user.displayName?.split(" ")[0] ?? user.email ?? "");
}

function showLogin() {
  $("#app-screen").classList.add("hidden");
  $("#login-screen").classList.remove("hidden");
  // Resetear estado
  _remitos       = [];
  _activeFilters = {};
}

// ═══════════════════════════════════════════════════════════
//  DATOS — suscripción en tiempo real
// ═══════════════════════════════════════════════════════════

function startDataListener(filters = {}) {
  showLoadingState();
  _DB.subscribeRemitos({
    filters,
    onData:  handleNewData,
    onError: (err) => {
      console.error("Firestore error:", err);
      showToast("Error al cargar datos: " + err.message, "error");
    },
  });
}

function handleNewData(remitos) {
  _remitos = remitos;
  renderTable(remitos);
  renderStats(remitos);
}

// ═══════════════════════════════════════════════════════════
//  FILTROS
// ═══════════════════════════════════════════════════════════

function applyFilters() {
  const from = $("#filter-from").value;
  const to   = $("#filter-to").value;

  if (!from && !to) {
    showToast("Seleccioná al menos una fecha para filtrar.", "info");
    return;
  }

  _activeFilters = { from, to };
  toggleEl("#filter-badge", true);
  startDataListener(_activeFilters);
}

function clearFilters() {
  _activeFilters = {};
  $("#filter-from").value = "";
  $("#filter-to").value   = "";
  toggleEl("#filter-badge", false);
  startDataListener();
}

// ═══════════════════════════════════════════════════════════
//  RENDERIZADO DE TABLA
// ═══════════════════════════════════════════════════════════

function showLoadingState() {
  toggleEl("#loading-state", true);
  toggleEl("#empty-state",   false);
  toggleEl("#table-wrapper", false);
}

function renderTable(remitos) {
  toggleEl("#loading-state", false);

  if (remitos.length === 0) {
    toggleEl("#empty-state",   true);
    toggleEl("#table-wrapper", false);
    return;
  }

  toggleEl("#empty-state",   false);
  toggleEl("#table-wrapper", true);

  const tbody = $("#remitos-body");
  tbody.innerHTML = remitos.map(renderRow).join("");

  // Eventos de edición y eliminación (delegación)
  tbody.querySelectorAll("[data-action='edit']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const remito = _remitos.find((r) => r.id === btn.dataset.id);
      if (remito) openRemitoModal(remito);
    });
  });

  tbody.querySelectorAll("[data-action='delete']").forEach((btn) => {
    btn.addEventListener("click", () => openDeleteModal(btn.dataset.id, btn.dataset.num));
  });
}

function renderRow(r) {
  const fechaStr = r.fecha instanceof Date && !isNaN(r.fecha)
    ? fmtDate.format(r.fecha)
    : "—";

  return `
    <tr>
      <td><span class="cell-numero">${esc(r.numeroRemito) || "—"}</span></td>
      <td class="cell-date">${fechaStr}</td>
      <td>${esc(r.chofer) || "—"}</td>
      <td><span class="tag tag-from">${esc(r.desde) || "—"}</span></td>
      <td><span class="tag tag-to">${esc(r.hasta) || "—"}</span></td>
      <td class="cell-litros">${fmtNum.format(r.cantidadLitros)}</td>
      <td class="col-actions">
        <div class="row-actions">
          <button class="btn-row btn-row-edit" data-action="edit" data-id="${r.id}" aria-label="Editar">✏️</button>
          <button class="btn-row btn-row-delete" data-action="delete" data-id="${r.id}" data-num="${esc(r.numeroRemito)}" aria-label="Eliminar">🗑️</button>
        </div>
      </td>
    </tr>`;
}

function renderStats(remitos) {
  const totalLitros = remitos.reduce((acc, r) => acc + (r.cantidadLitros || 0), 0);
  setText("#stat-count",  remitos.length.toString());
  setText("#stat-litros", fmtNum.format(totalLitros) + " L");
}

// ═══════════════════════════════════════════════════════════
//  MODAL: NUEVO / EDITAR REMITO
// ═══════════════════════════════════════════════════════════

function openRemitoModal(remito = null) {
  _editingId = remito?.id ?? null;

  setText("#modal-remito-title", remito ? "Editar Remito" : "Nuevo Remito");
  $("#form-error").textContent = "";

  if (remito) {
    $("#field-numero").value = remito.numeroRemito ?? "";
    $("#field-chofer").value = remito.chofer       ?? "";
    $("#field-desde").value  = remito.desde        ?? "";
    $("#field-hasta").value  = remito.hasta        ?? "";
    $("#field-litros").value = remito.cantidadLitros ?? "";
    // Formatear fecha para input[type=date]: "YYYY-MM-DD"
    $("#field-fecha").value  = remito.fecha instanceof Date
      ? remito.fecha.toISOString().slice(0, 10)
      : "";
  } else {
    clearRemitoForm();
    // Fecha de hoy por defecto
    $("#field-fecha").value = todayISOString();
  }

  openModal("modal-remito");
  // Focus al primer campo después de la animación
  setTimeout(() => $("#field-numero").focus(), 300);
}

function clearRemitoForm() {
  ["#field-numero", "#field-chofer", "#field-desde", "#field-hasta", "#field-litros", "#field-fecha", "#edit-id"]
    .forEach((sel) => { $("#"  + sel.slice(1)).value = ""; });
  $("#form-error").textContent = "";
}

async function handleSaveRemito() {
  const btn  = $("#btn-save");
  const errEl = $("#form-error");
  errEl.textContent = "";

  const data = {
    numeroRemito:   $("#field-numero").value.trim(),
    chofer:         $("#field-chofer").value.trim(),
    desde:          $("#field-desde").value.trim(),
    hasta:          $("#field-hasta").value.trim(),
    cantidadLitros: $("#field-litros").value,
    fecha:          $("#field-fecha").value,
  };

  // Validación básica
  const errors = validateRemito(data);
  if (errors.length) {
    errEl.textContent = errors[0];
    return;
  }

  btn.disabled    = true;
  btn.textContent = "Guardando…";

  try {
    if (_editingId) {
      await _DB.updateRemito(_editingId, data);
      showToast("Remito actualizado ✓", "success");
    } else {
      await _DB.addRemito(data);
      showToast("Remito guardado ✓", "success");
    }
    closeModal("modal-remito");
  } catch (err) {
    console.error(err);
    errEl.textContent = "Error al guardar: " + err.message;
  } finally {
    btn.disabled    = false;
    btn.textContent = "Guardar";
  }
}

function validateRemito(data) {
  const errors = [];
  if (!data.fecha)         errors.push("La fecha es obligatoria.");
  if (!data.chofer)        errors.push("El nombre del chofer es obligatorio.");
  if (!data.desde)         errors.push("La bodega de origen (Desde) es obligatoria.");
  if (!data.hasta)         errors.push("La bodega de destino (Hasta) es obligatoria.");
  const litros = parseFloat(data.cantidadLitros);
  if (isNaN(litros) || litros < 0) errors.push("La cantidad de litros debe ser un número válido.");
  return errors;
}

// ═══════════════════════════════════════════════════════════
//  MODAL: ELIMINACIÓN
// ═══════════════════════════════════════════════════════════

function openDeleteModal(id, numero) {
  _deletingId = id;
  setText("#delete-remito-num", numero || "sin número");
  openModal("modal-delete");
}

async function handleConfirmDelete() {
  if (!_deletingId) return;
  const btn = $("#btn-confirm-delete");
  btn.disabled    = true;
  btn.textContent = "Eliminando…";

  try {
    await _DB.deleteRemito(_deletingId);
    showToast("Remito eliminado.", "success");
    closeModal("modal-delete");
  } catch (err) {
    showToast("Error al eliminar: " + err.message, "error");
  } finally {
    btn.disabled    = false;
    btn.textContent = "Eliminar";
    _deletingId     = null;
  }
}

// ═══════════════════════════════════════════════════════════
//  MODAL: CONFIGURACIÓN IA
// ═══════════════════════════════════════════════════════════

// Información de cada proveedor: hint de dónde obtener la clave
const AI_PROVIDERS = {
  gemini: {
    label:       "Google Gemini Flash 2.5",
    placeholder: "AIza…",
    hint:        'Obtenela gratis en <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>',
  },
  claude: {
    label:       "Anthropic Claude",
    placeholder: "sk-ant-…",
    hint:        'Obtenela en <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>',
  },
  openai: {
    label:       "OpenAI GPT-4o",
    placeholder: "sk-…",
    hint:        'Obtenela en <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a>',
  },
};

function openSettings() {
  const savedProvider = localStorage.getItem("remitos_ai_provider") ?? "gemini";
  const savedKey      = localStorage.getItem("remitos_ai_key")      ?? "";

  const providerEl = $("#field-ai-provider");
  providerEl.value = savedProvider;
  $("#field-ai-key").value = savedKey;
  updateSettingsHint(savedProvider);

  // Actualizar hint cuando cambia el proveedor
  providerEl.onchange = (e) => updateSettingsHint(e.target.value);

  openModal("modal-settings");
}

function updateSettingsHint(provider) {
  const info = AI_PROVIDERS[provider] ?? AI_PROVIDERS.gemini;
  $("#field-ai-key").placeholder    = info.placeholder;
  $("#settings-hint").innerHTML     = info.hint;
}

function handleSaveSettings() {
  const provider = $("#field-ai-provider").value;
  const key      = $("#field-ai-key").value.trim();

  if (key) {
    localStorage.setItem("remitos_ai_provider", provider);
    localStorage.setItem("remitos_ai_key",      key);
    const label = AI_PROVIDERS[provider]?.label ?? provider;
    showToast(`${label} configurado ✓`, "success");
  } else {
    localStorage.removeItem("remitos_ai_provider");
    localStorage.removeItem("remitos_ai_key");
    showToast("Configuración de IA eliminada.", "info");
  }
  closeModal("modal-settings");
}

// ═══════════════════════════════════════════════════════════
//  OCR — ESCANEO DE REMITOS CON CLAUDE AI
// ═══════════════════════════════════════════════════════════

function handleScanImageSelected(e) {
  const file = e.target.files[0];
  if (!file) return;

  const preview  = $("#scan-preview");
  const analyzeBtn = $("#btn-analyze");
  const errEl    = $("#scan-error");
  const resultEl = $("#scan-result-msg");

  errEl.textContent     = "";
  resultEl.classList.add("hidden");

  // Mostrar preview
  const reader = new FileReader();
  reader.onload = (ev) => {
    _scanImageB64 = ev.target.result; // data:image/...;base64,...
    preview.src   = _scanImageB64;
    preview.classList.remove("hidden");
    analyzeBtn.disabled = false;
  };
  reader.readAsDataURL(file);
}

async function handleAnalyze() {
  const aiKey      = localStorage.getItem("remitos_ai_key");
  const aiProvider = localStorage.getItem("remitos_ai_provider") ?? "gemini";

  if (!aiKey) {
    toggleEl("#ai-key-warning", true);
    return;
  }
  toggleEl("#ai-key-warning", false);

  const statusEl   = $("#scan-status");
  const resultEl   = $("#scan-result-msg");
  const analyzeBtn = $("#btn-analyze");
  const errEl      = $("#scan-error");

  errEl.textContent = "";
  resultEl.classList.add("hidden");
  statusEl.classList.remove("hidden");
  analyzeBtn.disabled = true;

  try {
    // Despacha al proveedor correcto
    const extracted = await callOCR(aiProvider, aiKey, _scanImageB64);

    closeModal("modal-scan");
    statusEl.classList.add("hidden");

    openRemitoModal(null);
    if (extracted.numeroRemito)   $("#field-numero").value = extracted.numeroRemito;
    if (extracted.fecha)          $("#field-fecha").value  = extracted.fecha;
    if (extracted.chofer)         $("#field-chofer").value = extracted.chofer;
    if (extracted.desde)          $("#field-desde").value  = extracted.desde;
    if (extracted.hasta)          $("#field-hasta").value  = extracted.hasta;
    if (extracted.cantidadLitros) $("#field-litros").value = extracted.cantidadLitros;

    showToast("Datos extraídos. Revisá y guardá.", "success");

  } catch (err) {
    console.error("OCR error:", err);
    errEl.textContent = "Error al analizar: " + err.message;
  } finally {
    statusEl.classList.add("hidden");
    analyzeBtn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════
//  OCR — MOTOR MULTI-PROVEEDOR
// ═══════════════════════════════════════════════════════════

/** Prompt compartido por todos los proveedores */
const OCR_PROMPT = `Analizá esta imagen de un remito de transporte de líquidos.
Extraé exactamente los siguientes campos y respondé ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin bloques de código markdown.

Reglas de extracción:
- "numeroRemito": número o código del remito (ej: "0001-00123"). Si no se ve claramente, dejá vacío.
- "fecha": fecha del documento en formato "YYYY-MM-DD". Si no la encontrás, dejá vacío.
- "chofer": nombre completo del conductor. Está en la esquina inferior izquierda, JUSTO ARRIBA de la línea "FIRMA DEL CONDUCTOR". Si no se ve, dejá vacío.
- "desde": texto a la derecha del recuadro "DESDE". Bodega o punto de origen.
- "hasta": texto a la derecha del recuadro "HASTA". Bodega o punto de destino.
- "cantidadLitros": número bajo "Total Litros" o el valor mayor en la columna "Litros". Solo el número (ej: 15000.5). Si no se ve, devolvé 0.

Formato esperado (SOLO esto):
{"numeroRemito":"","fecha":"","chofer":"","desde":"","hasta":"","cantidadLitros":0}`;

/**
 * Despacha el OCR al proveedor configurado.
 * @param {"gemini"|"claude"|"openai"} provider
 * @param {string} apiKey
 * @param {string} imageDataUrl  — data:image/...;base64,...
 */
async function callOCR(provider, apiKey, imageDataUrl) {
  const [header, base64Data] = imageDataUrl.split(",");
  const mediaType = header.match(/data:([^;]+)/)[1];

  switch (provider) {
    case "gemini": return callGeminiOCR(apiKey, base64Data, mediaType);
    case "claude": return callClaudeOCR(apiKey, base64Data, mediaType);
    case "openai": return callOpenAIOCR(apiKey, base64Data, mediaType);
    default:       throw new Error(`Proveedor desconocido: ${provider}`);
  }
}

/** Parsea la respuesta de texto y devuelve el objeto JSON */
function parseOCRResponse(text) {
  const clean = text.replace(/```json|```/gi, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    throw new Error("La IA no devolvió un JSON válido. Intentá con una imagen más clara.");
  }
}

// ── Google Gemini Flash 2.5 ─────────────────────────────
async function callGeminiOCR(apiKey, base64Data, mediaType) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mediaType, data: base64Data } },
          { text: OCR_PROMPT },
        ],
      }],
      generationConfig: { maxOutputTokens: 400, temperature: 0.1 },
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Gemini HTTP ${response.status}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts
    ?.filter((p) => p.text)
    ?.map((p) => p.text)
    ?.join("") ?? "";

  return parseOCRResponse(text);
}

// ── Anthropic Claude ────────────────────────────────────
async function callClaudeOCR(apiKey, base64Data, mediaType) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
          { type: "text",  text: OCR_PROMPT },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Claude HTTP ${response.status}`);
  }

  const data = await response.json();
  const text = data.content?.filter((b) => b.type === "text").map((b) => b.text).join("") ?? "";
  return parseOCRResponse(text);
}

// ── OpenAI GPT-4o ───────────────────────────────────────
async function callOpenAIOCR(apiKey, base64Data, mediaType) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model:      "gpt-4o",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64Data}`, detail: "high" } },
          { type: "text",      text: OCR_PROMPT },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `OpenAI HTTP ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  return parseOCRResponse(text);
}

// ═══════════════════════════════════════════════════════════
//  EXPORTACIÓN — PDF
// ═══════════════════════════════════════════════════════════

export function exportToPDF(remitos) {
  if (!remitos.length) { showToast("No hay datos para exportar.", "info"); return; }

  // jsPDF está disponible como global window.jspdf.jsPDF
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  // Encabezado
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(APP.EXPORT_TITLE, 14, 16);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120);
  doc.text(`Generado: ${fmtDate.format(new Date())} | Total: ${remitos.length} remitos`, 14, 23);

  // Tabla
  doc.autoTable({
    startY: 28,
    head: [["N° Remito", "Fecha", "Chofer", "Desde", "Hasta", "Litros"]],
    body: remitos.map((r) => [
      r.numeroRemito || "—",
      r.fecha instanceof Date ? fmtDate.format(r.fecha) : "—",
      r.chofer || "—",
      r.desde  || "—",
      r.hasta  || "—",
      fmtNum.format(r.cantidadLitros),
    ]),
    styles: {
      fontSize: 9,
      cellPadding: 3,
    },
    headStyles: {
      fillColor:  [30, 35, 55],
      textColor:  [245, 158, 11],
      fontStyle:  "bold",
    },
    alternateRowStyles: { fillColor: [240, 242, 248] },
    columnStyles: { 5: { halign: "right" } },
  });

  // Totalizador al pie
  const totalLitros = remitos.reduce((a, r) => a + (r.cantidadLitros || 0), 0);
  const finalY = doc.lastAutoTable.finalY + 6;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0);
  doc.text(`Total Litros: ${fmtNum.format(totalLitros)} L`, 14, finalY);

  doc.save(`remitos_${todayISOString()}.pdf`);
  showToast("PDF generado ✓", "success");
}

// ═══════════════════════════════════════════════════════════
//  EXPORTACIÓN — EXCEL
// ═══════════════════════════════════════════════════════════

export function exportToExcel(remitos) {
  if (!remitos.length) { showToast("No hay datos para exportar.", "info"); return; }

  const headers = ["N° Remito", "Fecha", "Chofer", "Desde", "Hasta", "Litros"];
  const rows    = remitos.map((r) => [
    r.numeroRemito || "",
    r.fecha instanceof Date ? fmtDate.format(r.fecha) : "",
    r.chofer || "",
    r.desde  || "",
    r.hasta  || "",
    r.cantidadLitros ?? 0,
  ]);

  // Fila totalizadora
  rows.push(["", "", "", "", "TOTAL LITROS", remitos.reduce((a, r) => a + (r.cantidadLitros || 0), 0)]);

  const wsData = [headers, ...rows];
  const ws     = XLSX.utils.aoa_to_sheet(wsData);

  // Ancho de columnas
  ws["!cols"] = [14, 12, 22, 20, 20, 12].map((w) => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Remitos");
  XLSX.writeFile(wb, `remitos_${todayISOString()}.xlsx`);
  showToast("Excel generado ✓", "success");
}

// ═══════════════════════════════════════════════════════════
//  IMPORTACIÓN — Excel / CSV
// ═══════════════════════════════════════════════════════════

async function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  // Resetear el input para que se pueda volver a seleccionar el mismo archivo
  e.target.value = "";

  try {
    const data    = await file.arrayBuffer();
    const wb      = XLSX.read(data, { type: "array", cellDates: true });
    const ws      = wb.Sheets[wb.SheetNames[0]];
    const rows    = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    if (rows.length < 2) { showToast("El archivo no tiene datos.", "info"); return; }

    // Detectar encabezados (primer fila) para mapear columnas flexiblemente
    const headerRow = rows[0].map((h) => String(h).toLowerCase().trim());
    const colIndex  = buildColumnIndex(headerRow);

    const toImport = [];
    for (let i = 1; i < rows.length; i++) {
      const row    = rows[i];
      const litros = parseFloat(row[colIndex.litros]) || 0;
      // Saltar filas de totales o vacías
      if (!row[colIndex.chofer] && !row[colIndex.desde] && litros === 0) continue;

      toImport.push({
        numeroRemito:   String(row[colIndex.numero]  ?? "").trim(),
        fecha:          parseFechaImport(row[colIndex.fecha]),
        chofer:         String(row[colIndex.chofer]  ?? "").trim(),
        desde:          String(row[colIndex.desde]   ?? "").trim(),
        hasta:          String(row[colIndex.hasta]   ?? "").trim(),
        cantidadLitros: litros,
      });
    }

    if (!toImport.length) { showToast("No se encontraron remitos válidos en el archivo.", "info"); return; }

    // Guardar en Firestore
    let count = 0;
    for (const remito of toImport) {
      await _DB.addRemito(remito);
      count++;
    }

    showToast(`${count} remito(s) importado(s) ✓`, "success");

  } catch (err) {
    console.error("Import error:", err);
    showToast("Error al importar: " + err.message, "error");
  }
}

/** Detecta los índices de columna por nombre flexible */
function buildColumnIndex(headerRow) {
  const find = (...keywords) => {
    for (const kw of keywords) {
      const idx = headerRow.findIndex((h) => h.includes(kw));
      if (idx !== -1) return idx;
    }
    return -1;
  };
  return {
    numero: find("n°", "numero", "remito", "nro"),
    fecha:  find("fecha", "date"),
    chofer: find("chofer", "conductor", "transportista"),
    desde:  find("desde", "origen"),
    hasta:  find("hasta", "destino"),
    litros: find("litros", "cantidad", "total"),
  };
}

/** Convierte distintos formatos de fecha de Excel/CSV a string "YYYY-MM-DD" */
function parseFechaImport(raw) {
  if (!raw) return todayISOString();
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (typeof raw === "number") {
    // Número de serie de Excel
    const date = new Date(Math.round((raw - 25569) * 86400 * 1000));
    return date.toISOString().slice(0, 10);
  }
  // String: intentar parsear
  const d = new Date(raw);
  return isNaN(d) ? todayISOString() : d.toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════
//  MODALES — helpers
// ═══════════════════════════════════════════════════════════

function openModal(id) {
  const modal = $(`#${id}`);
  modal.classList.add("is-open");
  // Prevenir scroll del body en mobile
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  const modal = $(`#${id}`);
  modal.classList.remove("is-open");
  document.body.style.overflow = "";

  // Limpiar scan al cerrar
  if (id === "modal-scan") resetScanModal();
}

function resetScanModal() {
  _scanImageB64 = null;
  const preview = $("#scan-preview");
  preview.src   = "";
  preview.classList.add("hidden");
  $("#scan-status").classList.add("hidden");
  $("#scan-result-msg").classList.add("hidden");
  $("#scan-error").textContent = "";
  $("#ai-key-warning").classList.add("hidden");
  $("#btn-analyze").disabled   = true;
  $("#scan-image").value        = "";
}

// ═══════════════════════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════

/**
 * @param {string} message
 * @param {"success"|"error"|"info"} type
 * @param {number} [duration=3000]
 */
export function showToast(message, type = "info", duration = 3500) {
  const container = $("#toast-container");
  const toast     = document.createElement("div");
  const icons     = { success: "✓", error: "✕", info: "ℹ" };

  toast.className = `toast toast-${type}`;
  toast.textContent = `${icons[type]}  ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("is-hiding");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  }, duration);
}

// ═══════════════════════════════════════════════════════════
//  UTILIDADES
// ═══════════════════════════════════════════════════════════

/** querySelector alias */
const $ = (sel) => document.querySelector(sel);

/** Mostrar/ocultar elemento */
function toggleEl(sel, show) {
  const el = $(sel);
  if (el) el.classList.toggle("hidden", !show);
}

/** Setear textContent de forma segura */
function setText(sel, value) {
  const el = $(sel);
  if (el) el.textContent = value;
}

/** Escapar HTML para prevenir XSS */
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Retorna la fecha de hoy en formato "YYYY-MM-DD" */
function todayISOString() {
  return new Date().toISOString().slice(0, 10);
}
