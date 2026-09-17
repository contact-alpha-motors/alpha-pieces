// Qui peut faire quoi. Utilisé à la fois par le web et par Telegram/IA.
export const ROLES = ["admin", "boss", "magasinier", "atelier"];

const RULES = {
  "pieces.lire":        ["admin", "boss", "magasinier", "atelier"],
  "pieces.creer":       ["admin", "boss", "magasinier"],
  "pieces.modifier":    ["admin", "boss", "magasinier"],
  "pieces.supprimer":   ["admin", "boss"],
  "pieces.valider":     ["admin", "boss"],          // passer à « validee »
  "pieces.monter":      ["admin", "boss", "magasinier", "atelier"],
  "stock.lire":         ["admin", "boss", "magasinier", "atelier"],
  "stock.modifier":     ["admin", "boss", "magasinier"],
  "utilisateurs.gerer": ["admin"],
};

export function peut(user, action) {
  return !!user && user.actif !== false && (RULES[action] || []).includes(user.role);
}

export class Interdit extends Error {
  constructor(msg = "Action non autorisée pour votre rôle.") { super(msg); this.status = 403; }
}

export function exiger(user, action) {
  if (!peut(user, action)) throw new Interdit();
}

// Règles de changement de statut selon le rôle.
export function exigerStatut(user, ancien, nouveau) {
  if (ancien === nouveau) return;
  if (nouveau === "validee") return exiger(user, "pieces.valider");
  if (nouveau === "montee" && user.role === "atelier") {
    if (ancien !== "recue") throw new Interdit("L'atelier ne peut monter qu'une pièce déjà reçue.");
    return;
  }
  exiger(user, "pieces.modifier");
}
