import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { FIREBASE_CONFIG } from "./config.js";
import { initAuth }        from "./auth.js";
import { initDB }          from "./db.js";
import { initUI }          from "./ui.js";

const firebaseApp = initializeApp(FIREBASE_CONFIG);
const Auth = initAuth(firebaseApp);
const DB   = initDB(firebaseApp);
const UI   = initUI({ Auth, DB });
UI.mount();
