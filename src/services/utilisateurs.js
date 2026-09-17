import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { query } from "../db.js";
import { exiger, ROLES } from "./permissions.js";

const PUBLIC = "id, nom, email, role, actif, telegram_id IS NOT NULL AS telegram_lie, created_at";

export async function trouverParEmail(email) {
  const { rows } = await query("SELECT * FROM utilisateurs WHERE lower(email) = lower($1)", [email]);
  return rows[0];
}
export async function trouverParId(id) {
  const { rows } = await query("SELECT * FROM utilisateurs WHERE id = $1", [id]);
  return rows[0];
}
export async function trouverParTelegram(tgId) {
  const { rows } = await query("SELECT * FROM utilisateurs WHERE telegram_id = $1 AND actif", [tgId]);
  return rows[0];
}

function valider({ nom, email, role, motDePasse }, creation) {
  if (creation && (!nom || !email || !motDePasse)) throw Object.assign(new Error("Nom, email et mot de passe requis."), { status: 400 });
  if (role && !ROLES.includes(role)) throw Object.assign(new Error("Rôle inconnu."), { status: 400 });
  if (motDePasse && String(motDePasse).length < 8) throw Object.assign(new Error("Mot de passe : 8 caractères minimum."), { status: 400 });
}

export async function lister(admin) {
  exiger(admin, "utilisateurs.gerer");
  return (await query(`SELECT ${PUBLIC} FROM utilisateurs ORDER BY nom`)).rows;
}

export async function creer(admin, d) {
  if (admin) exiger(admin, "utilisateurs.gerer");
  valider(d, true);
  const hash = await bcrypt.hash(String(d.motDePasse), 12);
  try {
    const { rows } = await query(
      `INSERT INTO utilisateurs (nom,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING ${PUBLIC}`,
      [d.nom.trim(), d.email.trim().toLowerCase(), hash, d.role || "atelier"]);
    return rows[0];
  } catch (e) {
    if (e.code === "23505") throw Object.assign(new Error("Cet email existe déjà."), { status: 409 });
    throw e;
  }
}

export async function modifier(admin, id, d) {
  exiger(admin, "utilisateurs.gerer");
  valider(d, false);
  if (Number(id) === admin.id && (d.actif === false || (d.role && d.role !== "admin")))
    throw Object.assign(new Error("Vous ne pouvez pas retirer vos propres droits d'admin."), { status: 400 });
  const set = [], p = [];
  if (d.nom !== undefined)    { p.push(String(d.nom).trim()); set.push(`nom = $${p.length}`); }
  if (d.role !== undefined)   { p.push(d.role); set.push(`role = $${p.length}`); }
  if (d.actif !== undefined)  { p.push(!!d.actif); set.push(`actif = $${p.length}`); }
  if (d.motDePasse)           { p.push(await bcrypt.hash(String(d.motDePasse), 12)); set.push(`password_hash = $${p.length}`); }
  if (d.delierTelegram)       { set.push("telegram_id = NULL"); }
  if (!set.length) return null;
  p.push(id);
  const { rows } = await query(`UPDATE utilisateurs SET ${set.join(", ")} WHERE id = $${p.length} RETURNING ${PUBLIC}`, p);
  return rows[0];
}

export async function changerMonMotDePasse(user, ancien, nouveau) {
  const u = await trouverParId(user.id);
  if (!u || !(await bcrypt.compare(String(ancien || ""), u.password_hash))) throw Object.assign(new Error("Mot de passe actuel incorrect."), { status: 400 });
  valider({ motDePasse: nouveau }, false);
  await query("UPDATE utilisateurs SET password_hash = $1 WHERE id = $2", [await bcrypt.hash(String(nouveau), 12), user.id]);
}

export async function verifierMotDePasse(email, motDePasse) {
  const u = await trouverParEmail(email);
  const ok = u && u.actif && (await bcrypt.compare(String(motDePasse || ""), u.password_hash));
  return ok ? u : null;
}

// Code à 6 chiffres, valable 10 minutes, pour lier Telegram.
export async function genererCodeLiaison(user) {
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
  await query("DELETE FROM codes_liaison WHERE user_id = $1 OR expire_at < now()", [user.id]);
  await query("INSERT INTO codes_liaison (code,user_id,expire_at) VALUES ($1,$2, now() + interval '10 minutes')", [code, user.id]);
  return code;
}

export async function lierTelegram(code, tgId) {
  const { rows } = await query(
    "DELETE FROM codes_liaison WHERE code = $1 AND expire_at > now() RETURNING user_id", [String(code).trim()]);
  if (!rows[0]) return null;
  await query("UPDATE utilisateurs SET telegram_id = NULL WHERE telegram_id = $1", [tgId]);
  const { rows: [u] } = await query("UPDATE utilisateurs SET telegram_id = $1 WHERE id = $2 AND actif RETURNING *", [tgId, rows[0].user_id]);
  return u || null;
}
