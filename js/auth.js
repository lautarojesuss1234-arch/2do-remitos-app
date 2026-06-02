import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const ERROR_MESSAGES = {
  "auth/popup-closed-by-user":    "Cerraste la ventana antes de completar el inicio de sesión.",
  "auth/popup-blocked":           "El navegador bloqueó la ventana emergente. Permití los popups para este sitio.",
  "auth/cancelled-popup-request": "Operación cancelada.",
  "auth/network-request-failed":  "Sin conexión a internet. Verificá tu red e intentá de nuevo.",
  "auth/too-many-requests":       "Demasiados intentos. Esperá unos minutos antes de intentar de nuevo.",
};

export function initAuth(firebaseApp) {
  const auth     = getAuth(firebaseApp);
  const provider = new GoogleAuthProvider();

  async function loginWithGoogle() {
    try {
      const result = await signInWithPopup(auth, provider);
      return result.user;
    } catch (err) {
      const msg = ERROR_MESSAGES[err.code] || `Error al iniciar sesión: ${err.message}`;
      throw new Error(msg);
    }
  }

  async function logout() {
    await signOut(auth);
  }

  function onAuthChanged(callback) {
    return onAuthStateChanged(auth, callback);
  }

  function currentUser() {
    return auth.currentUser;
  }

  return { loginWithGoogle, logout, onAuthChanged, currentUser };
}
