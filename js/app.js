// ═══════════════════════════════════════════════════════════
//  app.js — Inicializador principal
//
//  Conecta Firebase con los módulos Auth, DB y UI.
//  Este es el único archivo cargado como <script type="module">
//  en el index.html; el resto se importa desde aquí.
// ═══════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import { FIREBASE_CONFIG } from "./config.js";
import { initAuth }        from "./auth.js";
import { initDB }          from "./db.js";
import { initUI }          from "./ui.js";

// ── Inicializar Firebase ────────────────────────────────
const firebaseApp = initializeApp(FIREBASE_CONFIG);

// ── Inicializar módulos ─────────────────────────────────
const Auth = initAuth(firebaseApp);
const DB   = initDB(firebaseApp);
const UI   = initUI({ Auth, DB });

// ── Montar la interfaz ──────────────────────────────────
UI.mount();
