// ═══════════════════════════════════════════════════════════
//  db.js — Operaciones CRUD con Firestore
// ═══════════════════════════════════════════════════════════

import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  where,
  onSnapshot,
  Timestamp,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { APP } from "./config.js";

/** @type {import('firebase/firestore').Firestore} */
let db;

/** Función para cancelar la suscripción activa de remitos */
let activeUnsubscribe = null;

/**
 * Inicializa el módulo de base de datos.
 * @param {import('firebase/app').FirebaseApp} firebaseApp
 */
export function initDB(firebaseApp) {
  db = getFirestore(firebaseApp);

  return {
    subscribeRemitos,
    addRemito,
    updateRemito,
    deleteRemito,
    unsubscribeAll,
  };
}

// ── Suscripción en tiempo real ──────────────────────────

/**
 * Suscribe a los remitos en tiempo real.
 * Siempre ordena de más reciente a más antiguo.
 * Soporta filtro opcional por rango de fechas.
 *
 * @param {object}   options
 * @param {Function} options.onData   - Recibe el array de remitos cada vez que cambia
 * @param {Function} options.onError  - Recibe el error si la suscripción falla
 * @param {object}   [options.filters]
 * @param {string}   [options.filters.from]  - Fecha ISO "YYYY-MM-DD" inicio del rango
 * @param {string}   [options.filters.to]    - Fecha ISO "YYYY-MM-DD" fin del rango
 */
function subscribeRemitos({ onData, onError, filters = {} }) {
  // Cancelar suscripción anterior si existe
  unsubscribeAll();

  const col         = collection(db, APP.COLLECTION);
  const constraints = [orderBy("fecha", "desc")];

  // Agregar filtros de fecha si existen
  // Nota: filtrar por el mismo campo sobre el que se ordena
  // NO requiere índice compuesto en Firestore.
  if (filters.from) {
    const fromDate = new Date(filters.from + "T00:00:00");
    constraints.push(where("fecha", ">=", Timestamp.fromDate(fromDate)));
  }
  if (filters.to) {
    const toDate = new Date(filters.to + "T23:59:59");
    constraints.push(where("fecha", "<=", Timestamp.fromDate(toDate)));
  }

  const q = query(col, ...constraints);

  activeUnsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const remitos = snapshot.docs.map((d) => normalizeRemito(d));
      onData(remitos);
    },
    onError
  );
}

// ── CRUD ───────────────────────────────────────────────

/**
 * Agrega un nuevo remito.
 * @param {RemitoData} data
 */
async function addRemito(data) {
  return addDoc(collection(db, APP.COLLECTION), {
    ...sanitizeRemito(data),
    creadoEn: serverTimestamp(),
  });
}

/**
 * Actualiza un remito existente.
 * @param {string} id
 * @param {RemitoData} data
 */
async function updateRemito(id, data) {
  return updateDoc(doc(db, APP.COLLECTION, id), {
    ...sanitizeRemito(data),
    actualizadoEn: serverTimestamp(),
  });
}

/**
 * Elimina un remito por ID.
 * @param {string} id
 */
async function deleteRemito(id) {
  return deleteDoc(doc(db, APP.COLLECTION, id));
}

/** Cancela la suscripción activa */
function unsubscribeAll() {
  if (activeUnsubscribe) {
    activeUnsubscribe();
    activeUnsubscribe = null;
  }
}

// ── Helpers internos ───────────────────────────────────

/**
 * Convierte un DocumentSnapshot de Firestore a un objeto plano
 * con `fecha` como objeto Date de JS.
 */
function normalizeRemito(docSnapshot) {
  const data = docSnapshot.data();
  return {
    id:             docSnapshot.id,
    numeroRemito:   data.numeroRemito   ?? "",
    chofer:         data.chofer         ?? "",
    desde:          data.desde          ?? "",
    hasta:          data.hasta          ?? "",
    cantidadLitros: data.cantidadLitros ?? 0,
    // Normalizar fecha: puede ser Timestamp de Firestore o Date
    fecha: data.fecha?.toDate
      ? data.fecha.toDate()
      : new Date(data.fecha ?? Date.now()),
  };
}

/**
 * Limpia y tipifica los datos antes de escribirlos en Firestore.
 * @param {RemitoData} data
 */
function sanitizeRemito(data) {
  // Convertir la fecha a Timestamp de Firestore
  let fechaTimestamp;
  if (data.fecha instanceof Date) {
    fechaTimestamp = Timestamp.fromDate(data.fecha);
  } else if (typeof data.fecha === "string") {
    // "YYYY-MM-DD" → asumir mediodia local para evitar desfases de timezone
    fechaTimestamp = Timestamp.fromDate(new Date(data.fecha + "T12:00:00"));
  } else {
    fechaTimestamp = Timestamp.now();
  }

  return {
    numeroRemito:   String(data.numeroRemito   ?? "").trim(),
    chofer:         String(data.chofer         ?? "").trim(),
    desde:          String(data.desde          ?? "").trim(),
    hasta:          String(data.hasta          ?? "").trim(),
    cantidadLitros: parseFloat(data.cantidadLitros) || 0,
    fecha:          fechaTimestamp,
  };
}

/**
 * @typedef {object} RemitoData
 * @property {string}        numeroRemito
 * @property {string}        chofer
 * @property {string}        desde
 * @property {string}        hasta
 * @property {number|string} cantidadLitros
 * @property {Date|string}   fecha
 */
