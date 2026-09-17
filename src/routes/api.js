import { Router } from "express";
import { authentifier, ouvrirSession, fermerSession, limiterConnexion } from "../auth.js";
import * as P from "../services/pieces.js";
import * as U from "../services/utilisateurs.js";

const r = Router();
const h = fn => (req, res) => Promise.resolve(fn(req, res)).then(d => res.json(d ?? { ok: true })).catch(e => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ erreur: e.status ? e.message : "Erreur serveur." });
});

// --- Session ---
r.post("/connexion", limiterConnexion, h(async (req, res) => {
  const u = await U.verifierMotDePasse(req.body.email, req.body.motDePasse);
  if (!u) throw Object.assign(new Error("Email ou mot de passe incorrect."), { status: 401 });
  ouvrirSession(req, res, u);
  return { nom: u.nom, role: u.role };
}));
r.post("/deconnexion", h(async (req, res) => { fermerSession(res); }));

r.use(authentifier);
r.get("/moi", h(req => req.user));
r.post("/moi/mot-de-passe", h(req => U.changerMonMotDePasse(req.user, req.body.ancien, req.body.nouveau)));
r.post("/moi/telegram", h(async req => ({ code: await U.genererCodeLiaison(req.user), bot: process.env.TELEGRAM_BOT_USERNAME || null })));

// --- Pièces ---
r.get("/pieces", h(req => P.listerPieces(req.user, req.query)));
r.post("/pieces", h(req => P.creerPiece(req.user, req.body)));
r.patch("/pieces/:id", h(req => P.modifierPiece(req.user, Number(req.params.id), req.body)));
r.delete("/pieces/:id", h(req => P.supprimerPiece(req.user, Number(req.params.id))));

// --- Stock ---
r.get("/stock", h(req => P.listerStock(req.user, req.query)));
r.post("/stock", h(req => P.ajouterStock(req.user, req.body)));
r.patch("/stock/:id", h(req => P.modifierStock(req.user, Number(req.params.id), req.body)));
r.delete("/stock/:id", h(req => P.supprimerStock(req.user, Number(req.params.id))));

// --- Synthèse ---
r.get("/resume", h(req => P.resume(req.user)));
r.get("/historique", h(req => P.historique(req.user, req.query)));

// --- Utilisateurs (admin) ---
r.get("/utilisateurs", h(req => U.lister(req.user)));
r.post("/utilisateurs", h(req => U.creer(req.user, req.body)));
r.patch("/utilisateurs/:id", h(req => U.modifier(req.user, Number(req.params.id), req.body)));

export default r;
