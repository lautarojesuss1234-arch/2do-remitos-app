// ═══════════════════════════════════════════════════════════
//  auth.js — Autenticación con Google (Firebase Auth)
// ═══════════════════════════════════════════════════════════

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Mensajes de error amigables para el usuario
const ERROR_MESSAGES = {
  "auth/popup-closed-by-user":    "Cerraste la ventana de login. Intentá de nuevo.",
  "auth/popup-blocked":           "El navegador bloqueó la ventana emergente. Habilitala e intentá de nuevo.",
  "auth/cancelled-popup-request": "Operación cancelada.",
  "auth/network-request-failed":  "Sin conexión a internet. Verificá tu red.",
  "auth/too-many-requests":       "Demasiados intentos. Esperá un momento.",
};

/**
 * Inicializa el módulo de autenticación.
 * @param {import('firebase/app').FirebaseApp} firebaseApp
 * @returns Métodos de autenticación
 */
export function initAuth(firebaseApp) {
  const auth     = getAuth(firebaseApp);
  const provider = new GoogleAuthProvider();

  return {
    /**
     * Abre el popup de Google para iniciar sesión.
     * @throws {Error} con mensaje legible si falla
     */
    loginWithGoogle: async () => {
      try {
        const result = await signInWithPopup(auth, provider);
        return result.user;
      } catch (err) {
        const msg = ERROR_MESSAGES[err.code] ?? "Error al iniciar sesión. Intentá de nuevo.";
        throw new Error(msg);
      }
    },

    /** Cierra la sesión del usuario actual */
    logout: () => signOut(auth),

    /**
     * Registra un callback que se ejecuta cada vez que cambia
     * el estado de autenticación (login / logout).
     * @param {(user: import('firebase/auth').User | null) => void} callback
     * @returns Función para desregistrar el listener
     */
    onAuthChanged: (callback) => onAuthStateChanged(auth, callback),

    /** Retorna el usuario actualmente autenticado o null */
    currentUser: () => auth.currentUser,
  };
}
