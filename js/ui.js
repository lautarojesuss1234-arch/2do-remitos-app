// ─── Module-level state ──────────────────────────────────────────────────────
let _Auth, _DB;
let _remitos      = [];
let _allRemitos   = [];
let _ctx          = { type: "personal", uid: null };
let _groups       = [];
let _currentGroup = null;
let _activeFilters = {};
let _editingId    = null;
let _deletingId   = null;
let _scanImageB64 = null;
let _remitoPhotoB64 = null;
let _activeTab    = "personal";
let _groupView    = "list";
let _switchTab    = () => {}; // set in mount()

// ─── Formatters (created once) ───────────────────────────────────────────────
const fmtDate = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
const fmtNum  = new Intl.NumberFormat("es-AR",  { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// ─── DOM helpers ─────────────────────────────────────────────────────────────
const ge  = (id)  => document.getElementById(id);
const qs  = (sel) => document.querySelector(sel);
const esc = (s)   => String(s ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function setText(id, val) {
  const el = ge(id);
  if (el) el.textContent = val;
}

function toggleEl(id, show) {
  const el = ge(id);
  if (el) el.classList.toggle("hidden", !show);
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function toast(msg, type = "info", duration = 3500) {
  const container = ge("toast-container");
  if (!container) return;
  const t = document.createElement("div");
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => {
    t.classList.add("is-hiding");
    setTimeout(() => t.remove(), 400);
  }, duration);
}

// ─── Modal helpers ────────────────────────────────────────────────────────────
function openModal(id) {
  const m = ge(id);
  if (m) m.classList.add("is-open");
}

function closeModal(id) {
  const m = ge(id);
  if (m) m.classList.remove("is-open");
}

// ─── Image optimization for OCR ──────────────────────────────────────────────
function optimizeImage(dataUrl, maxSize = 800) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        if (width > height) { height = Math.round(height * maxSize / width); width = maxSize; }
        else { width = Math.round(width * maxSize / height); height = maxSize; }
      }
      const canvas = document.createElement("canvas");
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      // Mejorar legibilidad para OCR
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.7)); // Calidad 0.7 es ideal para OCR y liviano
    };
    img.src = dataUrl;
  });
}

// ─── OCR providers ───────────────────────────────────────────────────────────
const OCR_PROMPT = `Eres un extractor de datos experto en remitos de transporte de vino. 
IMPORTANTE: La imagen puede estar rotada; analízala en cualquier orientación para encontrar los campos correctos.

REGLAS CRÍTICAS:
1. "desde": Busca el recuadro que dice "DESDE". El valor es el nombre que está INMEDIATAMENTE al lado o dentro de su área de influencia (ej: "LUIS GONZALO PALAU"). 
   - PROHIBIDO: No uses "AITOR IDER BALBO" ni "BAUDREL Y VIOR", esos son nombres de la empresa del encabezado.
2. "hasta": Busca el recuadro que dice "HASTA". El valor es el nombre al lado (ej: "A. I. BALBO").
3. "numeroRemito": Busca "N° -" y toma el número de 8 dígitos (ej: 00047253).
4. "chofer": Busca "FIRMA DEL CONDUCTOR" y toma el nombre que está justo ARRIBA de esa línea (ej: "RIVERO JUAN CARLOS").
5. "fecha": Busca "Fecha" y extrae en formato YYYY-MM-DD.
6. "cantidadLitros": Busca "TOTAL ENTREGADO" o "Total Litros" y toma el número mayor (ej: 31860).

Responde ÚNICAMENTE con el objeto JSON, sin texto extra.
Ejemplo: {"numeroRemito":"00047253","fecha":"2026-05-28","chofer":"RIVERO JUAN CARLOS","desde":"LUIS GONZALO PALAU","hasta":"A. I. BALBO","cantidadLitros":31860}`;

async function callGeminiOCR(apiKey, base64Data, mediaType) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: OCR_PROMPT },
            { inline_data: { mime_type: mediaType, data: base64Data } },
          ],
        }],
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callClaudeOCR(apiKey, base64Data, mediaType) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":                         "application/json",
      "x-api-key":                            apiKey,
      "anthropic-version":                    "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model:      "claude-opus-4-5",
      max_tokens: 512,
      messages: [{
        role: "user",
        content: [
          { type: "text",  text: OCR_PROMPT },
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
  const json = await res.json();
  return json.content?.[0]?.text || "";
}

async function callOpenAIOCR(apiKey, base64Data, mediaType) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 512,
      messages: [{
        role: "user",
        content: [
          { type: "text",      text: OCR_PROMPT },
          { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64Data}` } },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content || "";
}

async function callOCR(provider, apiKey, imageDataUrl) {
  const [, meta, base64Data] = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/) || [];
  const mediaType = meta || "image/jpeg";

  switch (provider) {
    case "gemini": return callGeminiOCR(apiKey, base64Data, mediaType);
    case "claude": return callClaudeOCR(apiKey, base64Data, mediaType);
    case "openai": return callOpenAIOCR(apiKey, base64Data, mediaType);
    default: throw new Error(`Proveedor desconocido: ${provider}`);
  }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function parseDateStr(str) {
  if (!str) return new Date();
  // DD/MM/YYYY
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(`${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}T12:00:00`);
  const d = new Date(str);
  return isNaN(d) ? new Date() : d;
}

function dateToISO(date) {
  if (!date) return todayISO();
  if (date instanceof Date) return date.toISOString().slice(0, 10);
  return todayISO();
}

// ─── PDF ##RD## import ────────────────────────────────────────────────────────
function extractRDData(pdfText) {
  try {
    const regex = /##RD(\d+)##([A-Za-z0-9+/=\s]+?)(?=##RD|$)/g;
    const chunks = [];
    let match;
    while ((match = regex.exec(pdfText)) !== null) {
      chunks.push({ offset: parseInt(match[1], 10), data: match[2].replace(/\s/g, "") });
    }
    if (!chunks.length) return null;
    chunks.sort((a, b) => a.offset - b.offset);
    const b64 = chunks.map((c) => c.data).join("");
    const json = atob(b64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function mapRDRecord(r) {
  const fechaRaw = r.fecha || r.date || "";
  const fechaDate = parseDateStr(fechaRaw);
  return {
    numeroRemito:   r.numero_remito  || r.numeroRemito  || "",
    fecha:          dateToISO(fechaDate),
    chofer:         r.nombre_chofer  || r.chofer        || "",
    desde:          r.bodega_origen  || r.desde         || "",
    hasta:          r.bodega_destino || r.hasta         || "",
    cantidadLitros: parseFloat(r.litros || r.cantidadLitros) || 0,
  };
}

// ─── PDF export helpers ───────────────────────────────────────────────────────
function encodeRDChunks(records) {
  const json   = JSON.stringify(records);
  const b64    = btoa(unescape(encodeURIComponent(json)));
  const chunks = [];
  const size   = 200;
  for (let i = 0; i < b64.length; i += size) {
    chunks.push(`##RD${i}##${b64.slice(i, i + size)}`);
  }
  return chunks.join("");
}

// ─── Dashboard helpers ────────────────────────────────────────────────────────
function groupBy(remitos, field, limit = 8) {
  const map = new Map();
  for (const r of remitos) {
    const key = r[field] || "—";
    map.set(key, (map.get(key) || 0) + r.cantidadLitros);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }));
}

function renderBarChart(containerId, entries, colorClass) {
  const container = ge(containerId);
  if (!container) return;
  if (!entries.length) { container.innerHTML = "<p style='color:var(--color-text-3);font-size:.85rem;padding:.5rem 0'>Sin datos</p>"; return; }
  const max = entries[0].value;
  container.innerHTML = entries.map(({ label, value }) => {
    const pct = max > 0 ? Math.round((value / max) * 100) : 0;
    return `<div class="chart-row">
      <div class="chart-row-header">
        <span class="chart-label">${esc(label)}</span>
        <span class="chart-value">${fmtNum.format(value)} L</span>
      </div>
      <div class="chart-bar-track">
        <div class="chart-bar-fill ${colorClass}" style="width:${pct}%"></div>
      </div>
    </div>`;
  }).join("");
}

// ─── Table render ─────────────────────────────────────────────────────────────
function applyClientFilters(remitos) {
  let result = remitos;
  const { chofer, origen, destino } = _activeFilters;
  if (chofer)  result = result.filter((r) => r.chofer === chofer);
  if (origen)  result = result.filter((r) => r.desde  === origen);
  if (destino) result = result.filter((r) => r.hasta  === destino);
  return result;
}

function renderRow(r) {
  const fecha = r.fecha instanceof Date ? fmtDate.format(r.fecha) : "—";
  const hasPhoto = _DB.getFotoLocal(r.id);
  return `<tr>
    <td class="col-num">
      <span class="cell-numero">${esc(r.numeroRemito || "—")}</span>
    </td>
    <td>${esc(fecha)}</td>
    <td>${esc(r.chofer)}</td>
    <td><span class="tag tag-from">${esc(r.desde)}</span></td>
    <td><span class="tag tag-to">${esc(r.hasta)}</span></td>
    <td class="col-litros">
      <span class="cell-litros">${fmtNum.format(r.cantidadLitros)}</span>
    </td>
    <td style="text-align:center">
      ${hasPhoto ? `<button class="btn-view-photo" data-id="${esc(r.id)}" title="Ver foto" style="background:none; border:none; cursor:pointer; font-size:1.2rem">🖼️</button>` : "—"}
    </td>
    <td class="col-actions">
      <div class="row-actions">
        <button class="btn-row btn-row-edit"  data-id="${esc(r.id)}" title="Editar">✏️</button>
        <button class="btn-row btn-row-delete" data-id="${esc(r.id)}" data-num="${esc(r.numeroRemito || '—')}" title="Eliminar">🗑️</button>
      </div>
    </td>
  </tr>`;
}

function renderTable(remitos) {
  const filtered = applyClientFilters(remitos);
  const loading  = ge("loading-state");
  const empty    = ge("empty-state");
  const wrapper  = ge("table-wrapper");
  const tbody    = ge("remitos-body");

  if (loading) loading.classList.add("hidden");

  const hasActiveFilters = Object.values(_activeFilters).some(Boolean) ||
    ge("filter-from")?.value || ge("filter-to")?.value;

  if (!filtered.length) {
    if (empty)   empty.classList.remove("hidden");
    if (wrapper) wrapper.classList.add("hidden");
    return;
  }

  if (empty)   empty.classList.add("hidden");
  if (wrapper) wrapper.classList.remove("hidden");
  if (tbody)   tbody.innerHTML = filtered.map(renderRow).join("");
}

function renderStats(remitos) {
  const filtered = applyClientFilters(remitos);
  const totalL = filtered.reduce((a, r) => a + r.cantidadLitros, 0);
  setText("stat-count",  filtered.length.toString());
  setText("stat-litros", fmtNum.format(totalL) + " L");

  const hasFilters = Object.values(_activeFilters).some(Boolean) ||
    ge("filter-from")?.value || ge("filter-to")?.value;
  toggleEl("filter-badge", hasFilters);
}

function populateFilterDropdowns(remitos) {
  const choferes = [...new Set(remitos.map((r) => r.chofer).filter(Boolean))].sort();
  const origenes = [...new Set(remitos.map((r) => r.desde).filter(Boolean))].sort();
  const destinos = [...new Set(remitos.map((r) => r.hasta).filter(Boolean))].sort();

  function refill(id, values) {
    const sel = ge(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">Todos</option>` +
      values.map((v) => `<option value="${esc(v)}" ${v === current ? "selected" : ""}>${esc(v)}</option>`).join("");
  }

  refill("filter-chofer",  choferes);
  refill("filter-origen",  origenes);
  refill("filter-destino", destinos);
}

// ─── Dashboard render ─────────────────────────────────────────────────────────
function renderDashboard() {
  const remitos = applyClientFilters(_allRemitos);

  if (!remitos.length) {
    toggleEl("dashboard-empty",   true);
    toggleEl("dashboard-content", false);
    return;
  }
  toggleEl("dashboard-empty",   false);
  toggleEl("dashboard-content", true);

  const totalL    = remitos.reduce((a, r) => a + r.cantidadLitros, 0);
  const choferes  = new Set(remitos.map((r) => r.chofer)).size;
  const origenes  = new Set(remitos.map((r) => r.desde)).size;

  setText("dash-total-remitos",  remitos.length.toString());
  setText("dash-total-litros",   fmtNum.format(totalL) + " L");
  setText("dash-total-choferes", choferes.toString());
  setText("dash-total-origenes", origenes.toString());

  renderBarChart("chart-choferes", groupBy(remitos, "chofer"),  "primary");
  renderBarChart("chart-origenes", groupBy(remitos, "desde"),   "secondary");
  renderBarChart("chart-destinos", groupBy(remitos, "hasta"),   "tertiary");
}

// ─── Data listener ────────────────────────────────────────────────────────────
function startDataListener(filters = {}) {
  ge("loading-state")?.classList.remove("hidden");
  ge("empty-state")?.classList.add("hidden");
  ge("table-wrapper")?.classList.add("hidden");

  _DB.subscribeRemitos({
    ctx: _ctx,
    filters,
    onData: handleNewData,
    onError: (err) => {
      ge("loading-state")?.classList.add("hidden");
      toast("Error al cargar datos: " + err.message, "error");
    },
  });
}

function handleNewData(remitos) {
  _allRemitos = remitos;
  _DB.cleanOldPhotos(remitos); // Limpieza de fotos locales antiguas
  renderTable(remitos);
  renderStats(remitos);
  populateFilterDropdowns(remitos);
  if (_activeTab === "dashboard") renderDashboard();
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function getAISettings() {
  return {
    provider: localStorage.getItem("remitos_ai_provider") || "gemini",
    key:      localStorage.getItem("remitos_ai_key")      || "",
  };
}

function saveAISettings(provider, key) {
  localStorage.setItem("remitos_ai_provider", provider);
  localStorage.setItem("remitos_ai_key",      key);
}

// ─── Form helpers ─────────────────────────────────────────────────────────────
function fillRemitoForm(r) {
  if (ge("field-numero")) ge("field-numero").value = r.numeroRemito || "";
  if (ge("field-fecha"))  ge("field-fecha").value  = r.fecha instanceof Date ? dateToISO(r.fecha) : (r.fecha || todayISO());
  if (ge("field-chofer")) ge("field-chofer").value = r.chofer || "";
  if (ge("field-desde"))  ge("field-desde").value  = r.desde  || "";
  if (ge("field-hasta"))  ge("field-hasta").value  = r.hasta  || "";
  if (ge("field-litros")) ge("field-litros").value = r.cantidadLitros != null ? r.cantidadLitros : "";
  setText("form-error", "");
}

function getFormData() {
  return {
    numeroRemito:   ge("field-numero")?.value.trim() || "",
    fecha:          ge("field-fecha")?.value         || todayISO(),
    chofer:         ge("field-chofer")?.value.trim() || "",
    desde:          ge("field-desde")?.value.trim()  || "",
    hasta:          ge("field-hasta")?.value.trim()  || "",
    cantidadLitros: parseFloat(ge("field-litros")?.value) || 0,
  };
}

function validateForm(data) {
  if (!data.fecha)          return "La fecha es obligatoria.";
  if (!data.chofer)         return "El nombre del chofer es obligatorio.";
  if (!data.desde)          return "La bodega de origen es obligatoria.";
  if (!data.hasta)          return "La bodega de destino es obligatoria.";
  if (isNaN(data.cantidadLitros) || data.cantidadLitros < 0)
    return "La cantidad de litros debe ser un número válido (≥ 0).";
  return null;
}

// ─── Export helpers ───────────────────────────────────────────────────────────
function exportToPDF(remitos) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Gestión de Remitos", 14, 15);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Exportado: ${fmtDate.format(new Date())}  ·  ${remitos.length} registros`, 14, 22);

  const head = [["N° Remito", "Fecha", "Chofer", "Desde", "Hasta", "Litros"]];
  const body = remitos.map((r) => [
    r.numeroRemito || "—",
    r.fecha instanceof Date ? fmtDate.format(r.fecha) : "—",
    r.chofer,
    r.desde,
    r.hasta,
    fmtNum.format(r.cantidadLitros),
  ]);

  doc.autoTable({
    head, body,
    startY: 27,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [245, 158, 11], textColor: 0 },
    alternateRowStyles: { fillColor: [245, 245, 245] },
  });

  // Embed ##RD## data as invisible text
  const rdText = encodeRDChunks(remitos.map((r) => ({
    numero_remito:  r.numeroRemito,
    fecha:          r.fecha instanceof Date ? fmtDate.format(r.fecha) : "",
    litros:         r.cantidadLitros,
    bodega_origen:  r.desde,
    bodega_destino: r.hasta,
    nombre_chofer:  r.chofer,
  })));

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(1);
  doc.text(rdText, 0, doc.internal.pageSize.height - 1);

  doc.save(`remitos_${todayISO()}.pdf`);
  toast("PDF exportado correctamente", "success");
}

function exportToExcel(remitos) {
  const data = [
    ["N° Remito", "Fecha", "Chofer", "Desde", "Hasta", "Litros"],
    ...remitos.map((r) => [
      r.numeroRemito || "",
      r.fecha instanceof Date ? fmtDate.format(r.fecha) : "",
      r.chofer,
      r.desde,
      r.hasta,
      r.cantidadLitros,
    ]),
  ];
  const ws = window.XLSX.utils.aoa_to_sheet(data);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "Remitos");
  window.XLSX.writeFile(wb, `remitos_${todayISO()}.xlsx`);
  toast("Excel exportado correctamente", "success");
}

// ─── Group helpers ────────────────────────────────────────────────────────────
function enterGroup(groupId, groupName) {
  _currentGroup = { id: groupId, name: groupName };
  _ctx          = { type: "group", groupId };
  _groupView    = "detail";

  _switchTab("personal");
  toggleEl("group-context-banner", true);
  setText("group-detail-name", groupName);

  _DB.unsubscribeAll();
  startDataListener(_activeFilters);
}

function backToGroupList() {
  _currentGroup = null;
  _ctx          = { type: "personal", uid: _Auth.currentUser()?.uid };
  _groupView    = "list";

  toggleEl("group-context-banner", false);
  _switchTab("grupos");

  _DB.unsubscribeAll();
  startDataListener({});
}

function renderGroupList(groups) {
  const container = ge("group-list");
  if (!container) return;
  if (!groups.length) {
    container.innerHTML = `<div class="state-view"><div class="state-icon">👥</div><p>Todavía no pertenecés a ningún grupo.<br>Creá uno o pedí que te inviten.</p></div>`;
    return;
  }
  container.innerHTML = groups.map((g) => `
    <div class="group-card">
      <div class="group-card-info">
        <div class="group-card-name">${esc(g.name)}</div>
        <div class="group-card-meta">${g.memberEmails?.length || 0} miembro(s)</div>
      </div>
      <button class="btn btn-primary btn-sm group-enter-btn" data-group-id="${esc(g.id)}" data-group-name="${esc(g.name)}">
        Entrar
      </button>
    </div>`).join("");
}

function renderMembersList(members) {
  const container = ge("members-list");
  if (!container) return;
  const currentEmail = _Auth.currentUser()?.email;
  container.innerHTML = members.map((m) => `
    <div class="member-row">
      <div class="member-email">
        ${esc(m.alias ? `@${m.alias}` : m.email)}
        ${m.email === currentEmail ? '<span class="member-you">Tú</span>' : ""}
      </div>
      ${m.email !== currentEmail && _currentGroup
        ? `<button class="member-remove-btn btn btn-danger btn-xs" data-email="${esc(m.email)}">Quitar</button>`
        : ""}
    </div>`).join("");
}

// ─── Scan / OCR ───────────────────────────────────────────────────────────────
function handleImageForScan(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    const preview = ge("scan-preview");
    if (preview) { preview.src = dataUrl; preview.classList.remove("hidden"); }

    try {
      const optimized = await optimizeImage(dataUrl);
      _scanImageB64 = optimized;
      setText("scan-status", "Imagen lista. Presioná 'Analizar' para extraer datos.");
      ge("scan-status")?.classList.remove("hidden");
      ge("scan-error")?.classList.add("hidden");
      ge("btn-analyze")?.removeAttribute("disabled");
    } catch {
      setText("scan-error", "No se pudo procesar la imagen.");
      ge("scan-error")?.classList.remove("hidden");
    }
  };
  reader.readAsDataURL(file);
}

async function handleAnalyzeScan() {
  if (!_scanImageB64) { toast("Primero seleccioná una imagen", "error"); return; }

  const ai = getAISettings();
  if (!ai.key) {
    toast("Configurá tu API Key en ⚙️ Configuración", "error");
    ge("ai-key-warning")?.classList.remove("hidden");
    return;
  }

  const btn = ge("btn-analyze");
  if (btn) { btn.disabled = true; btn.textContent = "Analizando…"; }
  setText("scan-result-msg", "");
  ge("scan-error")?.classList.add("hidden");

  try {
    const raw = await callOCR(ai.provider, ai.key, _scanImageB64);
    let cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    // Pre-fill form
    fillRemitoForm({
      numeroRemito:   parsed.numeroRemito   || parsed.numero_remito   || "",
      fecha:          parsed.fecha          || todayISO(),
      chofer:         parsed.chofer         || parsed.nombre_chofer   || "",
      desde:          parsed.desde          || parsed.bodega_origen   || "",
      hasta:          parsed.hasta          || parsed.bodega_destino  || "",
      cantidadLitros: parsed.cantidadLitros || parsed.litros          || 0,
    });

    closeModal("modal-scan");
    openModal("modal-remito");
    setText("modal-remito-title", "Nuevo Remito (desde OCR)");
    _editingId = null;
    _remitoPhotoB64 = _scanImageB64; // Pasar la foto optimizada al formulario
    
    // Mostrar preview en el formulario
    const cont = ge("photo-preview-container");
    const img = ge("form-photo-preview");
    if (img && _remitoPhotoB64) {
      img.src = _remitoPhotoB64;
      cont.style.display = "flex";
    }

    setText("scan-result-msg", "✅ Datos extraídos correctamente. Revisá y guardá.");
    ge("scan-result-msg")?.classList.remove("hidden");
    toast("Remito extraído con IA. Revisá los campos antes de guardar.", "info", 5000);
  } catch (err) {
    setText("scan-error", "Error al analizar: " + err.message);
    ge("scan-error")?.classList.remove("hidden");
    toast("Error al analizar la imagen", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Analizar con IA"; }
  }
}

// ─── Import helpers ────────────────────────────────────────────────────────────
async function importFromExcel(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const wb  = window.XLSX.read(e.target.result, { type: "array" });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1 });

      // Try to detect header row
      const header = rows[0]?.map((h) => String(h).toLowerCase().trim());
      const isHeader = header?.some((h) => h.includes("remito") || h.includes("chofer") || h.includes("litro"));
      const dataRows = isHeader ? rows.slice(1) : rows;

      let count = 0;
      for (const row of dataRows) {
        if (!row || !row.length) continue;
        // Columns: N°Remito, Fecha, Chofer, Desde, Hasta, Litros
        const record = {
          numeroRemito:   String(row[0] || "").trim(),
          fecha:          String(row[1] || "").trim() || todayISO(),
          chofer:         String(row[2] || "").trim(),
          desde:          String(row[3] || "").trim(),
          hasta:          String(row[4] || "").trim(),
          cantidadLitros: parseFloat(row[5]) || 0,
        };
        if (!record.chofer && !record.desde && !record.hasta) continue;
        await _DB.addRemito(_ctx, record);
        count++;
      }
      toast(`${count} remitos importados desde Excel`, "success");
    } catch (err) {
      toast("Error al importar Excel: " + err.message, "error");
    }
  };
  reader.readAsArrayBuffer(file);
}

async function importFromPDF(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const pdfData = new Uint8Array(e.target.result);
      const pdf     = await window.pdfjsLib.getDocument({ data: pdfData }).promise;
      let   text    = "";

      for (let i = 1; i <= pdf.numPages; i++) {
        const page  = await pdf.getPage(i);
        const tc    = await page.getTextContent();
        text += tc.items.map((it) => it.str).join(" ") + "\n";
      }

      const records = extractRDData(text);
      if (!records || !records.length) {
        toast("No se encontraron datos compatibles en este PDF", "error");
        return;
      }

      let count = 0;
      for (const r of records) {
        const mapped = mapRDRecord(r);
        if (!mapped.chofer && !mapped.desde && !mapped.hasta) continue;
        await _DB.addRemito(_ctx, mapped);
        count++;
      }
      toast(`${count} remitos importados desde PDF`, "success");
    } catch (err) {
      toast("Error al importar PDF: " + err.message, "error");
    }
  };
  reader.readAsArrayBuffer(file);
}

// ─── mount() ─────────────────────────────────────────────────────────────────
export function initUI({ Auth, DB }) {
  _Auth = Auth;
  _DB   = DB;

  function mount() {
    // Configure PDF.js worker
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    }

    // ── Auth state listener ──
    _Auth.onAuthChanged(async (user) => {
      if (user) {
        _ctx = { type: "personal", uid: user.uid };

        // Show app
        ge("login-screen")?.classList.add("hidden");
        ge("app-screen")?.classList.remove("hidden");

        // Set user info in header
        const avatar = ge("user-avatar");
        if (avatar) { avatar.src = user.photoURL || ""; avatar.alt = user.displayName || ""; }
        setText("user-name", user.displayName || user.email);

        // Load profile
        try {
          const profile = await _DB.getUserProfile(user.uid);
          if (!profile) {
            await _DB.saveUserProfile(user.uid, { email: user.email, displayName: user.displayName || "" });
          }
          if (ge("current-alias")) {
            const alias = profile?.alias || "";
            ge("current-alias").textContent = alias ? `@${alias}` : "Sin alias";
          }
        } catch {}

        // Start group listener
        _DB.subscribeUserGroups(user.email, {
          onData: (groups) => {
            _groups = groups;
            renderGroupList(groups);
          },
          onError: () => {},
        });

        // Start remitos listener
        startDataListener({});

      } else {
        // Show login
        ge("login-screen")?.classList.remove("hidden");
        ge("app-screen")?.classList.add("hidden");
        _DB.unsubscribeAll();
        _DB.unsubscribeGroups();
      }
    });

    // ── Login ──
    ge("btn-google-login")?.addEventListener("click", async () => {
      const errEl = ge("login-error");
      if (errEl) errEl.textContent = "";
      try {
        await _Auth.loginWithGoogle();
      } catch (err) {
        if (errEl) errEl.textContent = err.message;
      }
    });

    // ── Logout ──
    ge("btn-logout")?.addEventListener("click", async () => {
      _DB.unsubscribeAll();
      _DB.unsubscribeGroups();
      await _Auth.logout();
    });

    // ── Tab switching ──
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        switchTab(tab);
      });
    });

    function switchTab(tab) {
      _activeTab = tab;
      document.querySelectorAll(".tab-btn").forEach((b) =>
        b.classList.toggle("active", b.dataset.tab === tab)
      );
      document.querySelectorAll(".tab-panel").forEach((p) =>
        p.classList.toggle("hidden", p.id !== `tab-${tab}`)
      );
      if (tab === "dashboard") renderDashboard();
    }
    _switchTab = switchTab; // expose to module scope

    // ── New remito button ──
    ge("btn-new")?.addEventListener("click", () => {
      _editingId = null;
      _remitoPhotoB64 = null;
      ge("photo-preview-container").style.display = "none";
      fillRemitoForm({});
      setText("modal-remito-title", "Nuevo Remito");
      openModal("modal-remito");
    });

    ge("btn-new-empty")?.addEventListener("click", () => {
      _editingId = null;
      fillRemitoForm({ fecha: todayISO() });
      setText("modal-remito-title", "Nuevo Remito");
      openModal("modal-remito");
    });

    // ── Camera / Gallery buttons ──
    ge("btn-scan")?.addEventListener("click", () => {
      _scanImageB64 = null;
      const preview = ge("scan-preview");
      if (preview) { preview.src = ""; preview.classList.add("hidden"); }
      ge("scan-status")?.classList.add("hidden");
      ge("scan-error")?.classList.add("hidden");
      ge("ai-key-warning")?.classList.add("hidden");
      ge("btn-analyze")?.setAttribute("disabled", "");
      openModal("modal-scan");
      // Trigger camera
      setTimeout(() => ge("scan-camera")?.click(), 200);
    });

    ge("btn-gallery")?.addEventListener("click", () => {
      _scanImageB64 = null;
      const preview = ge("scan-preview");
      if (preview) { preview.src = ""; preview.classList.add("hidden"); }
      ge("scan-status")?.classList.add("hidden");
      ge("scan-error")?.classList.add("hidden");
      ge("ai-key-warning")?.classList.add("hidden");
      ge("btn-analyze")?.setAttribute("disabled", "");
      openModal("modal-scan");
      // Trigger gallery
      setTimeout(() => ge("scan-gallery-input")?.click(), 200);
    });

    ge("scan-camera")?.addEventListener("change", (e) => {
      handleImageForScan(e.target.files?.[0]);
      e.target.value = "";
    });

    ge("scan-gallery-input")?.addEventListener("change", (e) => {
      handleImageForScan(e.target.files?.[0]);
      e.target.value = "";
    });

    ge("btn-analyze")?.addEventListener("click", handleAnalyzeScan);

    // ── Save remito ──
    ge("btn-save")?.addEventListener("click", async () => {
      const data  = getFormData();
      const error = validateForm(data);
      if (error) { setText("form-error", error); return; }
      setText("form-error", "");

      const btn = ge("btn-save");
      if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

      try {
        // Validación de duplicados (Lógica pura)
        const isDuplicate = _allRemitos.some((r) => 
          r.id !== _editingId && 
          r.numeroRemito.trim().toLowerCase() === data.numeroRemito.trim().toLowerCase() &&
          r.chofer.trim().toLowerCase() === data.chofer.trim().toLowerCase()
        );

        if (isDuplicate) {
          if (!confirm(`Ya existe un remito N° ${data.numeroRemito} para el chofer ${data.chofer}. ¿Deseas guardarlo de todas formas?`)) {
            if (btn) { btn.disabled = false; btn.textContent = "Guardar"; }
            return;
          }
        }

        let savedId = _editingId;
        if (_editingId) {
          await _DB.updateRemito(_ctx, _editingId, data);
          toast("Remito actualizado", "success");
        } else {
          const docRef = await _DB.addRemito(_ctx, data);
          savedId = docRef.id;
          toast("Remito guardado", "success");
        }

        // Guardar foto en LocalStorage si existe
        if (_remitoPhotoB64 && savedId) {
          const success = _DB.saveFotoLocal(savedId, _remitoPhotoB64);
          if (!success) toast("No hay espacio suficiente para la foto en este dispositivo", "warning");
        }

        closeModal("modal-remito");
        _editingId = null;
        _remitoPhotoB64 = null;
        ge("photo-preview-container").style.display = "none";
      } catch (err) {
        setText("form-error", "Error al guardar: " + err.message);
        toast("Error al guardar", "error");
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Guardar"; }
      }
    });

    // ── Table row actions (delegation) ──
    ge("remitos-body")?.addEventListener("click", (e) => {
      const editBtn   = e.target.closest(".btn-row-edit");
      const deleteBtn = e.target.closest(".btn-row-delete");
      const photoBtn  = e.target.closest(".btn-view-photo");

      if (photoBtn) {
        const id = photoBtn.dataset.id;
        const foto = _DB.getFotoLocal(id);
        if (foto) {
          const win = window.open();
          win.document.write(`<img src="${foto}" style="max-width:100%">`);
        }
      }

      if (editBtn) {
        const id = editBtn.dataset.id;
        const r  = _allRemitos.find((x) => x.id === id);
        if (r) {
          _editingId = id;
          fillRemitoForm(r);

          // Mostrar foto si existe en LocalStorage
          const cont = ge("photo-preview-container");
          const img = ge("form-photo-preview");
          const localFoto = _DB.getFotoLocal(id);
          if (localFoto) {
            img.src = localFoto;
            cont.style.display = "flex";
          } else {
            cont.style.display = "none";
          }

          setText("modal-remito-title", "Editar Remito");
          openModal("modal-remito");
        }
      }

      if (deleteBtn) {
        _deletingId = deleteBtn.dataset.id;
        setText("delete-remito-num", deleteBtn.dataset.num || "—");
        openModal("modal-delete");
      }
    });

    // ── Confirm delete ──
    ge("btn-confirm-delete")?.addEventListener("click", async () => {
      if (!_deletingId) return;
      try {
        await _DB.deleteRemito(_ctx, _deletingId);
        toast("Remito eliminado", "success");
        closeModal("modal-delete");
        _deletingId = null;
      } catch (err) {
        toast("Error al eliminar: " + err.message, "error");
      }
    });

    // ── Filters ──
    ge("btn-toggle-advanced")?.addEventListener("click", () => {
      const adv = ge("advanced-filters");
      if (adv) {
        const isHidden = adv.classList.toggle("hidden");
        if (ge("btn-toggle-advanced")) {
          ge("btn-toggle-advanced").textContent = isHidden ? "🔍 Filtros avanzados" : "🔍 Ocultar filtros";
        }
      }
    });

    ge("btn-apply-filters")?.addEventListener("click", () => {
      const from    = ge("filter-from")?.value   || "";
      const to      = ge("filter-to")?.value     || "";
      const chofer  = ge("filter-chofer")?.value  || "";
      const origen  = ge("filter-origen")?.value  || "";
      const destino = ge("filter-destino")?.value || "";

      _activeFilters = { chofer, origen, destino };

      // Date filters go to Firestore query
      startDataListener({ from, to });
    });

    ge("btn-remove-photo")?.addEventListener("click", () => {
      _remitoPhotoB64 = null;
      ge("photo-preview-container").style.display = "none";
    });

    ge("btn-clear-filters")?.addEventListener("click", () => {
      _activeFilters = {};
      if (ge("filter-from"))    ge("filter-from").value    = "";
      if (ge("filter-to"))      ge("filter-to").value      = "";
      if (ge("filter-chofer"))  ge("filter-chofer").value  = "";
      if (ge("filter-origen"))  ge("filter-origen").value  = "";
      if (ge("filter-destino")) ge("filter-destino").value = "";
      startDataListener({});
      toast("Filtros limpiados", "info");
    });

    // ── Export ──
    ge("btn-export-pdf")?.addEventListener("click", () => {
      const filtered = applyClientFilters(_allRemitos);
      if (!filtered.length) { toast("No hay datos para exportar", "error"); return; }
      if (!window.jspdf) { toast("jsPDF no está disponible", "error"); return; }
      exportToPDF(filtered);
    });

    ge("btn-export-excel")?.addEventListener("click", () => {
      const filtered = applyClientFilters(_allRemitos);
      if (!filtered.length) { toast("No hay datos para exportar", "error"); return; }
      if (!window.XLSX) { toast("SheetJS no está disponible", "error"); return; }
      exportToExcel(filtered);
    });

    // ── Import ──
    ge("btn-import-excel")?.addEventListener("click", () => ge("import-file-excel")?.click());
    ge("btn-import-pdf")?.addEventListener("click",   () => ge("import-file-pdf")?.click());

    ge("import-file-excel")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) importFromExcel(file);
      e.target.value = "";
    });

    ge("import-file-pdf")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) importFromPDF(file);
      e.target.value = "";
    });

    // ── Settings ──
    ge("btn-settings")?.addEventListener("click", async () => {
      const ai = getAISettings();
      if (ge("field-ai-provider")) ge("field-ai-provider").value = ai.provider;
      if (ge("field-ai-key"))      ge("field-ai-key").value      = ai.key;

      // Load current alias
      const user = _Auth.currentUser();
      if (user) {
        const profile = await _DB.getUserProfile(user.uid).catch(() => null);
        if (ge("field-alias")) ge("field-alias").value = profile?.alias || "";
        setText("current-alias", profile?.alias ? `@${profile.alias}` : "Sin alias");
      }
      openModal("modal-settings");
    });

    ge("btn-save-settings")?.addEventListener("click", async () => {
      const alias    = ge("field-alias")?.value.toLowerCase().trim().replace(/\s/g, "") || "";
      const provider = ge("field-ai-provider")?.value || "gemini";
      const key      = ge("field-ai-key")?.value.trim() || "";

      saveAISettings(provider, key);

      const user = _Auth.currentUser();
      if (user && alias) {
        try {
          await _DB.saveUserProfile(user.uid, {
            email:       user.email,
            displayName: user.displayName || "",
            alias,
          });
          setText("current-alias", `@${alias}`);
        } catch (err) {
          toast("Error al guardar alias: " + err.message, "error");
          return;
        }
      }

      closeModal("modal-settings");
      toast("Configuración guardada", "success");
    });

    // ── AI provider hint ──
    ge("field-ai-provider")?.addEventListener("change", (e) => {
      const hints = {
        gemini: "Obtené tu clave en aistudio.google.com (gratuito)",
        claude: "Obtené tu clave en console.anthropic.com",
        openai: "Obtené tu clave en platform.openai.com",
      };
      setText("settings-hint", hints[e.target.value] || "");
    });

    // ── Groups — create ──
    ge("btn-create-group")?.addEventListener("click", () => {
      if (ge("field-group-name")) ge("field-group-name").value = "";
      openModal("modal-create-group");
    });

    ge("btn-save-group")?.addEventListener("click", async () => {
      const name = ge("field-group-name")?.value.trim();
      if (!name) { toast("El nombre del grupo es obligatorio", "error"); return; }

      const user = _Auth.currentUser();
      if (!user) return;

      const profile = await _DB.getUserProfile(user.uid).catch(() => null);

      try {
        await _DB.createGroup({
          name,
          creatorUid:   user.uid,
          creatorEmail: user.email,
          creatorAlias: profile?.alias || "",
        });
        closeModal("modal-create-group");
        toast(`Grupo "${name}" creado`, "success");
      } catch (err) {
        toast("Error al crear grupo: " + err.message, "error");
      }
    });

    // ── Groups — enter/back ──
    ge("group-list")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".group-enter-btn");
      if (btn) enterGroup(btn.dataset.groupId, btn.dataset.groupName);
    });

    ge("btn-back-group")?.addEventListener("click", () => {
      backToGroupList();
    });

    // ── Groups — invite ──
    ge("btn-invite-member")?.addEventListener("click", () => {
      if (ge("field-invite")) ge("field-invite").value = "";
      openModal("modal-invite");
    });

    ge("btn-save-invite")?.addEventListener("click", async () => {
      if (!_currentGroup) return;
      const input = ge("field-invite")?.value.trim();
      if (!input) { toast("Ingresá un email o alias", "error"); return; }

      try {
        const email = await _DB.resolveInvite(input);
        if (!email) {
          toast("No se encontró ningún usuario con ese alias. Pedile que configure su alias en ⚙️ primero.", "error");
          return;
        }
        await _DB.inviteMember(_currentGroup.id, email);
        closeModal("modal-invite");
        toast(`${email} agregado al grupo`, "success");
      } catch (err) {
        toast("Error al invitar: " + err.message, "error");
      }
    });

    // ── Groups — view members ──
    ge("btn-view-members")?.addEventListener("click", () => {
      const group = _groups.find((g) => g.id === _currentGroup?.id);
      if (group) renderMembersList(group.members || []);
      openModal("modal-members");
    });

    ge("members-list")?.addEventListener("click", async (e) => {
      const btn = e.target.closest(".member-remove-btn");
      if (!btn || !_currentGroup) return;
      const email = btn.dataset.email;
      if (!confirm(`¿Quitar a ${email} del grupo?`)) return;
      try {
        await _DB.removeMember(_currentGroup.id, email);
        toast(`${email} removido del grupo`, "success");
        closeModal("modal-members");
      } catch (err) {
        toast("Error al remover miembro: " + err.message, "error");
      }
    });

    // ── Modal close delegation ──
    document.addEventListener("click", (e) => {
      const closer = e.target.closest("[data-close]");
      if (closer) {
        const modalId = closer.dataset.close;
        closeModal(modalId);
      }
    });

    // Close modals on backdrop click
    document.querySelectorAll(".modal").forEach((modal) => {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal(modal.id);
      });
    });
  }

  return { mount };
}
