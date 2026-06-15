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
  setDoc,
  getDoc,
  arrayUnion,
  arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
export function initDB(firebaseApp) {
  const db = getFirestore(firebaseApp);

  // Active unsubscribe functions
  let _unsubRemitos = null;
  let _unsubGroups  = null;

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function getRemitosRef(ctx) {
    return ctx.type === "group"
      ? collection(db, "groups", ctx.groupId, "remitos")
      : collection(db, "users", ctx.uid, "remitos");
  }

  function normalizeRemito(docSnap) {
    const d = docSnap.data();
    return {
      id:            docSnap.id,
      numeroRemito:  d.numeroRemito  || "",
      chofer:        d.chofer        || "",
      desde:         d.desde         || "",
      hasta:         d.hasta         || "",
      cantidadLitros: typeof d.cantidadLitros === "number" ? d.cantidadLitros : 0,
      fecha:         d.fecha instanceof Timestamp ? d.fecha.toDate() : (d.fecha ? new Date(d.fecha) : new Date()),
      creadoEn:      d.creadoEn      || null,
      actualizadoEn: d.actualizadoEn || null,
      fotoUrl:       d.fotoUrl       || null,
      fotoPath:      d.fotoPath      || null,
      expiraEn:      d.expiraEn instanceof Timestamp ? d.expiraEn.toDate() : null,
    };
  }

  function sanitizeRemito(data) {
    const out = {
      numeroRemito:   (data.numeroRemito  || "").trim().toUpperCase(),
      chofer:         (data.chofer        || "").trim().toUpperCase(),
      desde:          (data.desde         || "").trim().toUpperCase(),
      hasta:          (data.hasta         || "").trim().toUpperCase(),
      cantidadLitros: parseFloat(data.cantidadLitros) || 0,
      fotoUrl:        data.fotoUrl  || null,
      fotoPath:       data.fotoPath || null,
    };

    // Calcular expiración (2 meses)
    const expDate = new Date();
    expDate.setMonth(expDate.getMonth() + 2);
    out.expiraEn = Timestamp.fromDate(expDate);

    // Parse fecha
    if (data.fecha instanceof Date) {
      out.fecha = Timestamp.fromDate(data.fecha);
    } else if (typeof data.fecha === "string" && data.fecha) {
      // Ensure no timezone shift by appending noon local time
      const d = new Date(data.fecha + "T12:00:00");
      out.fecha = Timestamp.fromDate(d);
    } else {
      out.fecha = Timestamp.now();
    }

    return out;
  }

  // ─── Remitos CRUD ────────────────────────────────────────────────────────────

  function subscribeRemitos({ ctx, filters = {}, onData, onError }) {
    if (_unsubRemitos) {
      _unsubRemitos();
      _unsubRemitos = null;
    }

    const ref = getRemitosRef(ctx);
    const constraints = [orderBy("fecha", "desc")];

    if (filters.from) {
      const fromDate = new Date(filters.from + "T00:00:00");
      constraints.push(where("fecha", ">=", Timestamp.fromDate(fromDate)));
    }
    if (filters.to) {
      const toDate = new Date(filters.to + "T23:59:59");
      constraints.push(where("fecha", "<=", Timestamp.fromDate(toDate)));
    }

    const q = query(ref, ...constraints);

    _unsubRemitos = onSnapshot(
      q,
      (snap) => {
        const remitos = snap.docs.map(normalizeRemito);
        onData(remitos);
      },
      (err) => {
        console.error("subscribeRemitos error:", err);
        if (onError) onError(err);
      }
    );

    return _unsubRemitos;
  }

  async function addRemito(ctx, data) {
    const ref = getRemitosRef(ctx);
    const clean = sanitizeRemito(data);
    clean.creadoEn = serverTimestamp();
    return addDoc(ref, clean);
  }

  async function updateRemito(ctx, id, data) {
    const ref = getRemitosRef(ctx);
    const clean = sanitizeRemito(data);
    clean.actualizadoEn = serverTimestamp();
    return updateDoc(doc(ref, id), clean);
  }

  async function deleteRemito(ctx, id) {
    const ref = getRemitosRef(ctx);
    // Borrar foto de LocalStorage si existe
    localStorage.removeItem(`foto_remito_${id}`);
    return deleteDoc(doc(ref, id));
  }

  function saveFotoLocal(id, base64) {
    try {
      localStorage.setItem(`foto_remito_${id}`, base64);
      return true;
    } catch (e) {
      console.error("LocalStorage lleno o error:", e);
      return false;
    }
  }

  function getFotoLocal(id) {
    return localStorage.getItem(`foto_remito_${id}`);
  }

  function cleanOldPhotos(remitos) {
    const now = new Date();
    remitos.forEach(r => {
      if (r.expiraEn && r.expiraEn < now) {
        localStorage.removeItem(`foto_remito_${r.id}`);
      }
    });
    
    // Limpieza agresiva: borrar cualquier cosa que empiece con foto_remito_ 
    // pero cuyo ID no esté en la lista actual de remitos cargados
    const currentIds = new Set(remitos.map(r => r.id));
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith("foto_remito_")) {
        const id = key.replace("foto_remito_", "");
        if (!currentIds.has(id)) {
          localStorage.removeItem(key);
        }
      }
    }
  }

  function unsubscribeAll() {
    if (_unsubRemitos) { _unsubRemitos(); _unsubRemitos = null; }
  }

  // ─── User Profile ────────────────────────────────────────────────────────────

  async function saveUserProfile(uid, data) {
    const profileRef = doc(db, "users", uid);
    const profileData = {
      email:       data.email       || "",
      displayName: data.displayName || "",
      updatedAt:   serverTimestamp(),
    };
    if (data.alias !== undefined) {
      profileData.alias = data.alias.toLowerCase().trim().replace(/\s/g, "");
    }
    await setDoc(profileRef, profileData, { merge: true });

    // Update alias index if alias provided
    if (data.alias) {
      const aliasKey = data.alias.toLowerCase().trim().replace(/\s/g, "");
      if (aliasKey) {
        const aliasRef = doc(db, "userAliases", aliasKey);
        await setDoc(aliasRef, { uid, email: data.email });
      }
    }
  }

  async function getUserProfile(uid) {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? snap.data() : null;
  }

  async function resolveInvite(emailOrAlias) {
    if (!emailOrAlias) return null;
    const val = emailOrAlias.trim();
    if (val.includes("@")) return val;

    // Lookup by alias
    const aliasKey = val.toLowerCase().replace(/\s/g, "");
    const snap = await getDoc(doc(db, "userAliases", aliasKey));
    if (snap.exists()) return snap.data().email;
    return null;
  }

  // ─── Groups ──────────────────────────────────────────────────────────────────

  function subscribeUserGroups(email, { onData, onError }) {
    if (_unsubGroups) { _unsubGroups(); _unsubGroups = null; }

    const q = query(
      collection(db, "groups"),
      where("memberEmails", "array-contains", email)
    );

    _unsubGroups = onSnapshot(
      q,
      (snap) => {
        const groups = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        onData(groups);
      },
      (err) => {
        console.error("subscribeUserGroups error:", err);
        if (onError) onError(err);
      }
    );

    return _unsubGroups;
  }

  async function createGroup({ name, creatorUid, creatorEmail, creatorAlias }) {
    const member = {
      uid:      creatorUid,
      email:    creatorEmail,
      alias:    creatorAlias || "",
      joinedAt: new Date().toISOString(),
    };
    return addDoc(collection(db, "groups"), {
      name,
      createdBy:    creatorUid,
      members:      [member],
      memberEmails: [creatorEmail],
      createdAt:    serverTimestamp(),
    });
  }

  async function inviteMember(groupId, email) {
    const groupRef = doc(db, "groups", groupId);
    const snap = await getDoc(groupRef);
    if (!snap.exists()) throw new Error("Grupo no encontrado");

    const data = snap.data();
    if (data.memberEmails.includes(email)) {
      throw new Error("Este usuario ya es miembro del grupo");
    }

    const member = {
      uid:      "",
      email,
      alias:    "",
      joinedAt: new Date().toISOString(),
    };

    await updateDoc(groupRef, {
      members:      arrayUnion(member),
      memberEmails: arrayUnion(email),
    });
  }

  async function removeMember(groupId, email) {
    const groupRef = doc(db, "groups", groupId);
    const snap = await getDoc(groupRef);
    if (!snap.exists()) return;

    const data    = snap.data();
    const members = (data.members || []).filter((m) => m.email !== email);

    await updateDoc(groupRef, {
      members,
      memberEmails: arrayRemove(email),
    });
  }

  function unsubscribeGroups() {
    if (_unsubGroups) { _unsubGroups(); _unsubGroups = null; }
  }

  // ─── Return public API ───────────────────────────────────────────────────────

  return {
    subscribeRemitos,
    addRemito,
    updateRemito,
    deleteRemito,
    unsubscribeAll,
    subscribeUserGroups,
    createGroup,
    inviteMember,
    removeMember,
    saveUserProfile,
    getUserProfile,
    resolveInvite,
    unsubscribeGroups,
    saveFotoLocal,
    getFotoLocal,
    cleanOldPhotos,
  };
}
