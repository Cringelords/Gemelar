import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
    signOut, onAuthStateChanged, RecaptchaVerifier, signInWithPhoneNumber 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
    getFirestore, collection, doc, getDoc, setDoc, addDoc, onSnapshot, query, where 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Deine getrennten Dateien importieren
import { GEMELAR_PRODUKTE } from "./produkte.js";
import { GEMELAR_RABATTE } from "./rabatte.js";
import { sendeSupportCode, ladeEingesendeteCodes } from "./eingesendete-codes.js";

// 1. DEINE FIREBASE KONFIGURATION
const firebaseConfig = {
    apiKey: "DEIN_API_KEY",
    authDomain: "DEIN_PROJEKT.firebaseapp.com",
    projectId: "DEIN_PROJEKT_ID",
    storageBucket: "DEIN_PROJEKT.appspot.com",
    messagingSenderId: "DEINE_ID",
    appId: "DEINE_APP_ID"
};

const ADMIN_UID = "HIER_DEINE_PERSOENLICHE_FIREBASE_UID_EINTRAGEN";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let selectedProduct = null;
let activeDiscountCode = null;
let activeDiscountPercent = 0;

// --- 1. PRODUKTE AUS produkte.js RENDERN ---
function renderProdukte() {
    const shopGrid = document.getElementById("shop-grid");
    const guthabenGrid = document.getElementById("guthaben-grid");
    shopGrid.innerHTML = "";
    guthabenGrid.innerHTML = "";

    GEMELAR_PRODUKTE.forEach((prod) => {
        const card = document.createElement("div");
        card.className = "product-card fade-in";

        card.innerHTML = `
            <img src="${prod.bild}" alt="${prod.titel}">
            <div class="product-info">
                <div>
                    <h3>${prod.titel}</h3>
                    <p class="muted">${prod.beschreibung}</p>
                </div>
                <div>
                    <div class="product-price">${prod.preis.toFixed(2)} €</div>
                    <button type="button" class="btn-primary full-width buy-trigger">💳 Mit Bankkarte kaufen</button>
                </div>
            </div>
        `;

        card.querySelector(".buy-trigger").addEventListener("click", () => openCheckout(prod));

        if (prod.kategorie === "guthaben") {
            guthabenGrid.appendChild(card);
        } else {
            shopGrid.appendChild(card);
        }
    });
}
renderProdukte();

// --- 2. CHECKOUT & EINMAL-RABATTCODES ---
const checkoutModal = document.getElementById("checkout-modal");
const discountInput = document.getElementById("discount-input");
const discountMsg = document.getElementById("discount-msg");
const discountAppliedText = document.getElementById("discount-applied-text");

function openCheckout(prod) {
    selectedProduct = prod;
    activeDiscountCode = null;
    activeDiscountPercent = 0;
    discountInput.value = "";
    discountMsg.textContent = "";
    discountAppliedText.classList.add("hidden");

    document.getElementById("checkout-prod-title").textContent = prod.titel;
    document.getElementById("checkout-prod-price").textContent = `${prod.preis.toFixed(2)} €`;
    checkoutModal.classList.remove("hidden");
}

document.getElementById("close-checkout").onclick = () => checkoutModal.classList.add("hidden");

// Rabattcode prüfen (aus rabatte.js + Prüfung in Firebase ob schon eingelöst)
document.getElementById("apply-discount-btn").onclick = async () => {
    const code = discountInput.value.trim().toUpperCase();
    discountMsg.textContent = "";

    if (!code || !GEMELAR_RABATTE[code]) {
        discountMsg.textContent = "Ungültiger Rabattcode.";
        return;
    }

    // Prüfen, ob Code schon einmal eingelöst wurde
    const usedRef = doc(db, "eingeloeste_rabatte", code);
    const usedSnap = await getDoc(usedRef);

    if (usedSnap.exists()) {
        discountMsg.textContent = "Dieser Rabattcode wurde bereits eingelöst und ist nicht mehr gültig.";
        return;
    }

    activeDiscountCode = code;
    activeDiscountPercent = GEMELAR_RABATTE[code];
    const neuerPreis = selectedProduct.preis * (1 - activeDiscountPercent / 100);

    document.getElementById("checkout-prod-price").textContent = `${neuerPreis.toFixed(2)} €`;
    discountAppliedText.textContent = `✅ ${activeDiscountPercent}% Rabatt (${code}) angewendet!`;
    discountAppliedText.classList.remove("hidden");
};

// Kauf bestätigen: Code als verbraucht markieren, Bestellung ins Profil speichern & Stripe öffnen
document.getElementById("confirm-pay-btn").onclick = async () => {
    if (!selectedProduct) return;

    // 1. Einmal-Rabattcode dauerhaft sperren
    if (activeDiscountCode) {
        await setDoc(doc(db, "eingeloeste_rabatte", activeDiscountCode), {
            eingeloestAm: new Date().toISOString(),
            von: currentUser ? currentUser.uid : "Gast"
        });
    }

    // 2. Bestellung im Profil speichern (inkl. Guthaben-Code falls vorhanden)
    if (currentUser) {
        const endpreis = selectedProduct.preis * (1 - activeDiscountPercent / 100);
        await addDoc(collection(db, "bestellungen"), {
            userId: currentUser.uid,
            titel: selectedProduct.titel,
            preis: endpreis.toFixed(2),
            guthabenCode: selectedProduct.guthabenCode || null,
            datum: new Date().toLocaleString("de-DE")
        });
    }

    checkoutModal.classList.add("hidden");
    window.open(selectedProduct.stripeLink, "_blank", "noopener,noreferrer");
};

// --- 3. SUPPORT-CODES EINSENDEN ---
document.getElementById("support-code-form").onsubmit = async (e) => {
    e.preventDefault();
    const codeVal = document.getElementById("support-code-input").value.trim();
    const noteVal = document.getElementById("support-note-input").value.trim();
    const sender = currentUser ? (currentUser.email || currentUser.phoneNumber) : "Anonymer Supporter";

    await sendeSupportCode(db, sender, codeVal, noteVal);
    e.target.reset();
    document.getElementById("support-feedback").textContent = "Vielen Dank! Dein Code wurde sicher übermittelt.";
};

// --- 4. LOGIN, REGISTRIERUNG & PROFIL ---
const loginModal = document.getElementById("login-modal");
const profileModal = document.getElementById("profile-modal");
let isRegisterMode = false;

document.getElementById("open-login-btn").onclick = () => loginModal.classList.remove("hidden");
document.getElementById("close-modal").onclick = () => loginModal.classList.add("hidden");
document.getElementById("open-profile-btn").onclick = () => profileModal.classList.remove("hidden");
document.getElementById("close-profile").onclick = () => profileModal.classList.add("hidden");

// Umschalten: Anmelden vs. Registrieren
const modeLoginBtn = document.getElementById("mode-login");
const modeRegisterBtn = document.getElementById("mode-register");
const emailSubmitBtn = document.getElementById("email-submit-btn");

modeLoginBtn.onclick = () => {
    isRegisterMode = false;
    modeLoginBtn.classList.add("active");
    modeRegisterBtn.classList.remove("active");
    document.getElementById("auth-modal-title").textContent = "Anmelden bei Gemelar";
    emailSubmitBtn.textContent = "Einloggen";
};

modeRegisterBtn.onclick = () => {
    isRegisterMode = true;
    modeRegisterBtn.classList.add("active");
    modeLoginBtn.classList.remove("active");
    document.getElementById("auth-modal-title").textContent = "Neues Konto registrieren";
    emailSubmitBtn.textContent = "Kostenlos registrieren";
};

// Tabs: E-Mail vs. Telefon
const tabEmail = document.getElementById("tab-email");
const tabPhone = document.getElementById("tab-phone");
const emailForm = document.getElementById("email-auth-form");
const phoneForm = document.getElementById("phone-auth-form");

tabEmail.onclick = () => {
    tabEmail.classList.add("active"); tabPhone.classList.remove("active");
    emailForm.classList.remove("hidden"); phoneForm.classList.add("hidden");
};
tabPhone.onclick = () => {
    tabPhone.classList.add("active"); tabEmail.classList.remove("active");
    phoneForm.classList.remove("hidden"); emailForm.classList.add("hidden");
};

// E-Mail Login oder Registrierung ausführen
emailForm.onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById("auth-email").value;
    const pass = document.getElementById("auth-password").value;
    const errorEl = document.getElementById("auth-error");
    errorEl.textContent = "";

    try {
        if (isRegisterMode) {
            await createUserWithEmailAndPassword(auth, email, pass);
        } else {
            await signInWithEmailAndPassword(auth, email, pass);
        }
        loginModal.classList.add("hidden");
    } catch (err) {
        errorEl.textContent = "Fehler: " + err.message;
    }
};

// Telefon Login / Registrierung
let confirmationResult;
document.getElementById("send-sms-btn").onclick = async () => {
    const phone = document.getElementById("auth-phone").value;
    try {
        if (!window.recaptchaVerifier) {
            window.recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
        }
        confirmationResult = await signInWithPhoneNumber(auth, phone, window.recaptchaVerifier);
        document.getElementById("sms-code").classList.remove("hidden");
        document.getElementById("verify-sms-btn").classList.remove("hidden");
    } catch (err) {
        document.getElementById("auth-error").textContent = "SMS-Fehler: " + err.message;
    }
};

phoneForm.onsubmit = async (e) => {
    e.preventDefault();
    const code = document.getElementById("sms-code").value;
    try {
        await confirmationResult.confirm(code);
        loginModal.classList.add("hidden");
    } catch (err) {
        document.getElementById("auth-error").textContent = "Ungültiger SMS-Code.";
    }
};

document.getElementById("logout-btn").onclick = () => signOut(auth);

// Profil & Bestellungen laden, sobald jemand eingeloggt ist
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    const openLoginBtn = document.getElementById("open-login-btn");
    const openProfileBtn = document.getElementById("open-profile-btn");
    const logoutBtn = document.getElementById("logout-btn");
    const adminCodesPanel = document.getElementById("admin-codes-panel");

    if (user) {
        openLoginBtn.classList.add("hidden");
        openProfileBtn.classList.remove("hidden");
        logoutBtn.classList.remove("hidden");

        document.getElementById("profile-email-display").textContent = user.email || user.phoneNumber || user.uid;
        ladeNutzerBestellungen(user.uid);

        // Nur für dich (Admin): Eingesendete Support-Codes anzeigen
        if (user.uid === ADMIN_UID) {
            adminCodesPanel.classList.remove("hidden");
            ladeEingesendeteCodes(db, document.getElementById("admin-codes-list"));
        }
    } else {
        openLoginBtn.classList.remove("hidden");
        openProfileBtn.classList.add("hidden");
        logoutBtn.classList.add("hidden");
        adminCodesPanel.classList.add("hidden");
    }
});

function ladeNutzerBestellungen(uid) {
    const q = query(collection(db, "bestellungen"), where("userId", "==", uid));
    onSnapshot(q, (snapshot) => {
        const list = document.getElementById("user-orders-list");
        list.innerHTML = "";

        if (snapshot.empty) {
            list.innerHTML = "<p class='muted'>Du hast noch keine Bestellungen getätigt.</p>";
            return;
        }

        snapshot.forEach((doc) => {
            const order = doc.data();
            const item = document.createElement("div");
            item.className = "order-item";

            let codeHtml = "";
            if (order.guthabenCode) {
                codeHtml = `<div class="guthaben-code-box">🔑 Dein Guthaben-Code: ${order.guthabenCode}</div>`;
            }

            item.innerHTML = `
                <div><strong>${order.titel}</strong> – ${order.preis} €</div>
                <div class="muted">Bestellt am: ${order.datum}</div>
                ${codeHtml}
            `;
            list.appendChild(item);
        });
    });
}