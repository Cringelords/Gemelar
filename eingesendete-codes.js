// eingesendete-codes.js - Verwaltet und listet alle eingesendeten Support-Codes

import { collection, addDoc, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Speichert einen neuen Support-Code sicher in der Datenbank
export async function sendeSupportCode(db, userEmail, codeText, nachricht) {
    await addDoc(collection(db, "support_codes"), {
        absender: userEmail || "Gast",
        code: codeText,
        nachricht: nachricht || "-",
        zeitpunkt: new Date().toLocaleString("de-DE")
    });
}

// Listet alle eingesendeten Codes live für dich (Admin) auf
export function ladeEingesendeteCodes(db, containerElement) {
    const q = query(collection(db, "support_codes"), orderBy("zeitpunkt", "desc"));
    onSnapshot(q, (snapshot) => {
        if (!containerElement) return;
        containerElement.innerHTML = "";
        
        if (snapshot.empty) {
            containerElement.innerHTML = "<p class='muted'>Noch keine Support-Codes eingesendet.</p>";
            return;
        }

        snapshot.forEach((doc) => {
            const item = doc.data();
            const row = document.createElement("div");
            row.className = "code-log-item";
            row.innerHTML = `
                <div><strong>Code:</strong> <code>${item.code}</code></div>
                <div><small>Von: ${item.absender} | ${item.zeitpunkt}</small></div>
                <div><small>Notiz: ${item.nachricht}</small></div>
            `;
            containerElement.appendChild(row);
        });
    });
}