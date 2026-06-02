// ═══════════════════════════════════════════════════════════
//  db.js — Operaciones CRUD con Firestore
//  Soporta: remitos personales (/users/{uid}/remitos)
//           remitos de grupo   (/groups/{groupId}/remitos)
// ═══════════════════════════════════════════════════════════

import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  query, orderBy, where, onSnapshot, Timestamp, serverTimestamp,
  setDoc, getDoc, arrayUnion, arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { APP } from "./config.js";

let db;
let activeUnsubscribe  = null;
let groupsUnsubscribe  = null;

export function initDB(firebaseApp) {
  db = getFirestore(firebaseApp);
  return {
    subscribeRemitos, addRemito, updateRemito, deleteRemito, unsubscribeAll,
    subscribeUserGroups, createGroup, inviteMember, removeMember,
    saveUserProfile, getUserProfile, resolveInvite, unsubscribeGroups,
  };
}

// ── Helpers de ruta ─────────────────────────────────────
function getRemitosRef(ctx) {
  return ctx.type === "group"
    ? collection(db, "groups", ctx.groupId, "remitos")
    : collection(db, "users", ctx.uid, "remitos");
}

function getDocRef(ctx, id) {
  return ctx.type === "group"
    ? doc(db, "groups", ctx.groupId, "remitos", id)
    : doc(db, "users", ctx.uid, "remitos", id);
}

// ── Suscripción en tiempo real ──────────────────────────
function subscribeRemitos({ ctx, filters = {}, onData, onError }) {
  unsubscribeAll();
  const constraints = [orderBy("fecha", "desc")];
  if (filters.from) constraints.push(where("fecha", ">=", Timestamp.fromDate(new Date(filters.from + "T00:00:00"))));
  if (filters.to)   constraints.push(where("fecha", "<=", Timestamp.fromDate(new Date(filters.to   + "T23:59:59"))));

  activeUnsubscribe = onSnapshot(
    query(getRemitosRef(ctx), ...constraints),
    (snap) => onData(snap.docs.map(normalizeRemito)),
    onError,
  );
}

// ── CRUD ────────────────────────────────────────────────
async function addRemito(data, ctx) {
  return addDoc(getRemitosRef(ctx), { ...sanitizeRemito(data), creadoEn: serverTimestamp() });
}

async function updateRemito(id, data, ctx) {
  return updateDoc(getDocRef(ctx, id), { ...sanitizeRemito(data), actualizadoEn: serverTimestamp() });
}

async function deleteRemito(id, ctx) {
  return deleteDoc(getDocRef(ctx, id));
}

function unsubscribeAll() {
  if (activeUnsubscribe) { activeUnsubscribe(); activeUnsubscribe = null; }
}

// ── Grupos ───────────────────────────────────────────────
function subscribeUserGroups(email, { onData, onError }) {
  if (groupsUnsubscribe) { groupsUnsubscribe(); groupsUnsubscribe = null; }
  const q = query(collection(db, "groups"), where("memberEmails", "array-contains", email));
  groupsUnsubscribe = onSnapshot(q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError,
  );
}

async function createGroup({ name, creatorUid, creatorEmail, creatorAlias }) {
  return addDoc(collection(db, "groups"), {
    name: name.trim(),
    createdBy: creatorUid,
    members: [{ uid: creatorUid, email: creatorEmail, alias: creatorAlias || "", joinedAt: new Date().toISOString() }],
    memberEmails: [creatorEmail],
    createdAt: serverTimestamp(),
  });
}

async function inviteMember(groupId, email) {
  return updateDoc(doc(db, "groups", groupId), {
    memberEmails: arrayUnion(email),
    members: arrayUnion({ email, alias: "", uid: "", joinedAt: new Date().toISOString() }),
  });
}

async function removeMember(groupId, email) {
  const snap = await getDoc(doc(db, "groups", groupId));
  if (!snap.exists()) return;
  const members = (snap.data().members || []).filter((m) => m.email !== email);
  return updateDoc(doc(db, "groups", groupId), { memberEmails: arrayRemove(email), members });
}

// ── Perfil de usuario / Alias ────────────────────────────
async function saveUserProfile(uid, { alias, email, displayName }) {
  const data = { email, displayName: displayName || "", updatedAt: serverTimestamp() };
  if (alias !== undefined) data.alias = alias.toLowerCase().trim();
  await setDoc(doc(db, "users", uid), data, { merge: true });
  if (alias) await setDoc(doc(db, "userAliases", alias.toLowerCase().trim()), { uid, email });
}

async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

async function resolveInvite(emailOrAlias) {
  if (emailOrAlias.includes("@")) return emailOrAlias;
  const snap = await getDoc(doc(db, "userAliases", emailOrAlias.toLowerCase().trim()));
  return snap.exists() ? snap.data().email : null;
}

function unsubscribeGroups() {
  if (groupsUnsubscribe) { groupsUnsubscribe(); groupsUnsubscribe = null; }
}

// ── Normalización y sanitización ─────────────────────────
function normalizeRemito(d) {
  const data = d.data();
  return {
    id: d.id,
    numeroRemito:   data.numeroRemito   ?? "",
    chofer:         data.chofer         ?? "",
    desde:          data.desde          ?? "",
    hasta:          data.hasta          ?? "",
    cantidadLitros: data.cantidadLitros ?? 0,
    fecha: data.fecha?.toDate ? data.fecha.toDate() : new Date(data.fecha ?? Date.now()),
  };
}

function sanitizeRemito(data) {
  let fechaTimestamp;
  if (data.fecha instanceof Date)      fechaTimestamp = Timestamp.fromDate(data.fecha);
  else if (typeof data.fecha === "string") fechaTimestamp = Timestamp.fromDate(new Date(data.fecha + "T12:00:00"));
  else                                 fechaTimestamp = Timestamp.now();
  return {
    numeroRemito:   String(data.numeroRemito   ?? "").trim(),
    chofer:         String(data.chofer         ?? "").trim(),
    desde:          String(data.desde          ?? "").trim(),
    hasta:          String(data.hasta          ?? "").trim(),
    cantidadLitros: parseFloat(data.cantidadLitros) || 0,
    fecha:          fechaTimestamp,
  };
}
