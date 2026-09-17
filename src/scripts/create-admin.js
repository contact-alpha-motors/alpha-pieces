// Usage : node src/scripts/create-admin.js "Nom" email@exemple.com MotDePasse
import { creer } from "../services/utilisateurs.js";
import { pool } from "../db.js";
const [nom, email, motDePasse] = process.argv.slice(2);
if (!nom || !email || !motDePasse) { console.log('Usage : npm run create-admin -- "Nom" email motdepasse'); process.exit(1); }
try { const u = await creer(null, { nom, email, motDePasse, role: "admin" }); console.log("Admin créé :", u.email); }
catch (e) { console.error("Erreur :", e.message); process.exitCode = 1; }
await pool.end();
