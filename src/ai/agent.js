// Agent IA (OpenRouter, compatible OpenAI). Lit librement ; toute écriture
// est proposée puis exécutée seulement après confirmation humaine.
import OpenAI from "openai";
import { query } from "../db.js";
import * as P from "../services/pieces.js";
import { peut } from "../services/permissions.js";

let _client = null;
const client = () => {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY manquante : l'assistant IA est désactivé.");
  return (_client ??= new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: { "HTTP-Referer": process.env.PUBLIC_URL || "", "X-Title": "Alpha Motors Pieces" },
  }));
};
const MODEL = process.env.AI_MODEL || "z-ai/glm-5.3-flash";

const fonction = (name, description, properties = {}, required = []) =>
  ({ type: "function", function: { name, description, parameters: { type: "object", properties, required } } });

const STATUT_ENUM = { type: "string", enum: Object.keys(P.STATUTS) };
const TOOLS = [
  fonction("rechercher_pieces", "Chercher des lignes de commande. Tous les filtres sont optionnels.", {
    texte: { type: "string", description: "désignation, référence, VIN, note…" },
    vehicule: { type: "string" }, statut: STATUT_ENUM, commande: { type: "string" } }),
  fonction("resume_general", "Synthèse : nombre de pièces par statut, alertes, avancement par véhicule."),
  fonction("rechercher_stock", "Chercher ce qui est en stock au magasin.", { texte: { type: "string" } }),
  fonction("historique_recent", "Derniers changements (qui, quoi, quand).", {
    type: { type: "string", enum: ["commande", "stock"] }, limite: { type: "integer" } }),
  fonction("proposer_changement_statut", "Proposer de changer le statut d'une ou plusieurs pièces (ids issus de rechercher_pieces). Nécessite confirmation.", {
    ids: { type: "array", items: { type: "integer" } }, statut: STATUT_ENUM }, ["ids", "statut"]),
  fonction("proposer_modification_piece", "Proposer de modifier prix, référence, fournisseur, quantité, date prévue ou note d'une pièce. Nécessite confirmation.", {
    id: { type: "integer" }, prix: { type: "number" }, ref: { type: "string" }, fournisseur: { type: "string" },
    qte: { type: "integer" }, date_prevue: { type: "string", description: "AAAA-MM-JJ" }, note: { type: "string" } }, ["id"]),
  fonction("proposer_ajout_pieces", "Proposer d'ajouter des lignes à une commande (ex. lues sur une photo de facture). Nécessite confirmation.", {
    lignes: { type: "array", items: { type: "object", properties: {
      commande: { type: "string" }, vehicule: { type: "string" }, vin: { type: "string" }, ref: { type: "string" },
      designation: { type: "string" }, qte: { type: "integer" }, prix: { type: "number" }, fournisseur: { type: "string" },
      statut: STATUT_ENUM, note: { type: "string" } }, required: ["commande", "vehicule", "designation"] } } }, ["lignes"]),
  fonction("proposer_mouvement_stock", "Proposer d'entrer (+) ou sortir (−) une quantité d'un article de stock existant (id issu de rechercher_stock), ou d'en créer un (sans id). Nécessite confirmation.", {
    id: { type: "integer" }, delta: { type: "integer" }, designation: { type: "string" }, ref: { type: "string" },
    vehicule: { type: "string" }, rayon: { type: "string" }, motif: { type: "string" } }, ["delta"]),
];

const SYSTEM = user => `Tu es l'assistant pièces détachées d'Alpha Motors (garage automobile, Afrique francophone, monnaie FCFA).
Tu parles à ${user.nom}, rôle « ${user.role} ». Réponds en français simple, court, adapté à Telegram (pas de tableaux Markdown).
Données : lignes de commande (statuts : ${Object.entries(P.STATUTS).map(([k, v]) => `${k}=${v}`).join(", ")}) et stock du magasin.
Le stock augmente automatiquement quand une pièce passe à « recue » et diminue quand elle passe à « montee ».
Règles :
- Consulte toujours la base avec les outils avant de répondre ; n'invente jamais une pièce, un prix ou une quantité.
- Pour toute modification, trouve d'abord les bons ids, puis appelle un outil « proposer_… ». L'utilisateur confirmera par un bouton. Ne dis jamais qu'une modification est faite : dis qu'elle attend sa confirmation.
- Si plusieurs pièces correspondent et que c'est ambigu, demande laquelle.
- Sur une photo (facture, bon, pièce, étiquette) : décris ce que tu lis, puis propose les ajouts ou mises à jour pertinents.
- Montants : format « 45 000 FCFA ». Date du jour : ${new Date().toISOString().slice(0, 10)}.`;

const PERMISSION = {
  proposer_changement_statut: "pieces.monter", proposer_modification_piece: "pieces.modifier",
  proposer_ajout_pieces: "pieces.creer", proposer_mouvement_stock: "stock.modifier",
};

async function executerLecture(user, name, a) {
  switch (name) {
    case "rechercher_pieces":
      return (await P.listerPieces(user, { ...a, limite: 40 })).map(p => ({
        id: p.id, commande: p.commande, vehicule: p.vehicule, vin: p.vin || undefined, ref: p.ref || undefined,
        designation: p.designation, qte: p.qte, prix: p.prix, statut: p.statut, fournisseur: p.fournisseur || undefined,
        date_prevue: p.date_prevue || undefined, note: p.note || undefined }));
    case "resume_general": return P.resume(user);
    case "rechercher_stock": return (await P.listerStock(user, a)).slice(0, 40);
    case "historique_recent":
      return (await P.historique(user, { type: a.type, limite: Math.min(a.limite || 15, 30) }))
        .map(h => ({ quand: h.at, qui: h.nom || "système", via: h.source, texte: h.texte }));
  }
}

async function libelleProposition(name, a) {
  if (name === "proposer_changement_statut") {
    const { rows } = await query("SELECT designation, vehicule FROM pieces WHERE id = ANY($1::int[])", [a.ids]);
    return `Passer à « ${P.STATUTS[a.statut]} » :\n` + rows.map(r => `• ${r.designation} (${r.vehicule})`).join("\n");
  }
  if (name === "proposer_modification_piece") {
    const { rows: [p] } = await query("SELECT designation, vehicule FROM pieces WHERE id = $1", [a.id]);
    const ch = Object.entries(a).filter(([k]) => k !== "id").map(([k, v]) => `${k} = ${v}`).join(", ");
    return `Modifier ${p ? `${p.designation} (${p.vehicule})` : "#" + a.id} : ${ch}`;
  }
  if (name === "proposer_ajout_pieces")
    return `Ajouter ${a.lignes.length} ligne(s) :\n` + a.lignes.slice(0, 25).map(l =>
      `• ${l.designation} × ${l.qte ?? 1}${l.prix ? ` à ${Number(l.prix).toLocaleString("fr-FR")} FCFA` : ""} — ${l.vehicule}`).join("\n");
  if (name === "proposer_mouvement_stock") {
    let nom = a.designation;
    if (a.id) nom = (await query("SELECT designation FROM stock WHERE id = $1", [a.id])).rows[0]?.designation || "#" + a.id;
    return `Stock ${a.delta > 0 ? "+" : ""}${a.delta} : ${nom}${a.motif ? ` (${a.motif})` : ""}`;
  }
}

// Exécution après clic sur « Confirmer ».
export async function executerAction(user, action) {
  const { name, args: a } = action, src = "telegram";
  switch (name) {
    case "proposer_changement_statut":
      for (const id of a.ids) await P.modifierPiece(user, id, { statut: a.statut }, src);
      return `✅ ${a.ids.length} pièce(s) → ${P.STATUTS[a.statut]}`;
    case "proposer_modification_piece": {
      const { id, ...champs } = a;
      const p = await P.modifierPiece(user, id, champs, src);
      return `✅ ${p.designation} mise à jour`;
    }
    case "proposer_ajout_pieces":
      for (const l of a.lignes) await P.creerPiece(user, l, src);
      return `✅ ${a.lignes.length} ligne(s) ajoutée(s)`;
    case "proposer_mouvement_stock":
      if (a.id) { const s = await P.modifierStock(user, a.id, { delta: a.delta, motif: a.motif }, src); return `✅ ${s.designation} : ${s.qte} en stock`; }
      if (a.delta < 0) throw Object.assign(new Error("Impossible de sortir un article qui n'existe pas en stock."), { status: 400 });
      { const s = await P.ajouterStock(user, { ...a, qte: a.delta }, src); return `✅ ${s.designation} : ${s.qte} en stock`; }
  }
  throw new Error("Action inconnue");
}

/**
 * @param user  utilisateur lié
 * @param historiqueChat  messages précédents [{role, content}]
 * @param entree  { texte, images: [dataUrl] }
 * @returns { texte, propositions: [{id, resume}] , messages }
 */
export async function repondre(user, historiqueChat, { texte, images = [] }) {
  const contenu = images.length
    ? [{ type: "text", text: texte || "Analyse cette image." }, ...images.map(url => ({ type: "image_url", image_url: { url } }))]
    : texte;
  const messages = [{ role: "system", content: SYSTEM(user) }, ...historiqueChat, { role: "user", content: contenu }];
  const propositions = [];
  const extra = process.env.AI_PROVIDER ? { provider: { order: [process.env.AI_PROVIDER], allow_fallbacks: true } } : {};

  for (let tour = 0; tour < 6; tour++) {
    const rep = await client().chat.completions.create({ model: MODEL, messages, tools: TOOLS, temperature: 0.2, max_tokens: 1200, ...extra });
    const msg = rep.choices[0].message;
    messages.push(msg);
    if (!msg.tool_calls?.length) {
      // on ne garde pas les images en mémoire (coût), seulement le texte
      const memo = [...historiqueChat, { role: "user", content: (texte || "") + (images.length ? " [photo envoyée]" : "") }, { role: "assistant", content: msg.content || "" }];
      return { texte: msg.content || "…", propositions, memo };
    }
    for (const call of msg.tool_calls) {
      let resultat;
      try {
        const a = JSON.parse(call.function.arguments || "{}");
        const name = call.function.name;
        if (name.startsWith("proposer_")) {
          if (!peut(user, PERMISSION[name])) throw new Error("Votre rôle ne permet pas cette action.");
          const resume = await libelleProposition(name, a);
          const { rows: [act] } = await query(
            "INSERT INTO actions_en_attente (user_id, action, resume) VALUES ($1,$2,$3) RETURNING id",
            [user.id, { name, args: a }, resume]);
          propositions.push({ id: act.id, resume });
          resultat = { statut: "en attente de confirmation par l'utilisateur" };
        } else {
          resultat = await executerLecture(user, name, a);
        }
      } catch (e) {
        resultat = { erreur: e.message };
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(resultat).slice(0, 12000) });
    }
  }
  return { texte: "Je n'ai pas réussi à terminer, reformulez la demande.", propositions, memo: historiqueChat };
}
