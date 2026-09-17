import jwt from "jsonwebtoken";
import { trouverParId } from "./services/utilisateurs.js";

const COOKIE = "alpha_session";
const secret = () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET manquant ou trop court (32 caractères min).");
  return process.env.JWT_SECRET;
};

export function ouvrirSession(res, user) {
  const token = jwt.sign({ uid: user.id }, secret(), { expiresIn: "7d" });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 7 * 864e5 });
}
export function fermerSession(res) { res.clearCookie(COOKIE); }

export async function authentifier(req, res, next) {
  try {
    const { uid } = jwt.verify(req.cookies?.[COOKIE] || "", secret());
    const u = await trouverParId(uid);
    if (!u || !u.actif) throw new Error();
    req.user = { id: u.id, nom: u.nom, email: u.email, role: u.role, actif: u.actif, telegram_lie: !!u.telegram_id };
    next();
  } catch {
    res.status(401).json({ erreur: "Session expirée, reconnectez-vous." });
  }
}

// Limite simple contre les attaques par force brute sur la connexion.
const essais = new Map();
export function limiterConnexion(req, res, next) {
  const k = req.ip, now = Date.now();
  const e = (essais.get(k) || []).filter(t => now - t < 15 * 60e3);
  if (e.length >= 10) return res.status(429).json({ erreur: "Trop de tentatives. Réessayez dans 15 minutes." });
  e.push(now); essais.set(k, e);
  next();
}
