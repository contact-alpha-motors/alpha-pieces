// Logique métier unique : le web, Telegram et l'IA passent tous par ici.
import { query, tx } from "../db.js";
import { exiger, exigerStatut } from "./permissions.js";

export const STATUTS = {
  demandee: "Demandée", devis: "Devis reçu", validee: "Validée",
  commandee: "Commandée", recue: "Reçue", montee: "Montée",
};

const CHAMPS = ["commande","vehicule","vin","ref","designation","emplacement","qte","unite","prix","fournisseur","statut","date_prevue","note"];

export const cleStock = o =>
  (o.ref ? "r-" + o.ref : "d-" + o.designation + "-" + (o.vehicule || ""))
    .toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").slice(0, 150);

async function journal(c, { texte, type = "commande", source = "web", userId = null }) {
  await c.query("INSERT INTO historique (texte,type,source,user_id) VALUES ($1,$2,$3,$4)", [texte, type, source, userId]);
}

function nettoyer(o) {
  const r = {};
  for (const k of CHAMPS) if (o[k] !== undefined) r[k] = o[k];
  if (r.qte !== undefined) r.qte = Math.max(0, parseInt(r.qte, 10) || 0);
  if (r.prix !== undefined) r.prix = r.prix === "" || r.prix === null ? null : Math.max(0, Number(r.prix));
  if (r.date_prevue === "") r.date_prevue = null;
  if (r.statut !== undefined && !STATUTS[r.statut]) throw Object.assign(new Error("Statut inconnu"), { status: 400 });
  for (const k of ["commande","vehicule","vin","ref","designation","emplacement","unite","fournisseur","note"])
    if (r[k] !== undefined) r[k] = String(r[k] ?? "").trim().slice(0, 500);
  return r;
}

// Le stock contient ce qui est « Reçue » mais pas encore « Montée ».
async function mouvementStock(c, piece, ancien, nouveau, ctx) {
  if (piece.designation === "Main d'œuvre") return;
  const q = piece.qte || 0;
  const delta = (nouveau === "recue" ? q : 0) - (ancien === "recue" ? q : 0);
  if (!delta) return;
  const { rows } = await c.query(
    `INSERT INTO stock (cle,designation,ref,vehicule,qte) VALUES ($1,$2,$3,$4,GREATEST(0,$5))
     ON CONFLICT (cle) DO UPDATE SET qte = GREATEST(0, stock.qte + $5), updated_at = now()
     RETURNING qte`,
    [cleStock(piece), piece.designation, piece.ref || "", piece.vehicule || "", delta]);
  await journal(c, { ...ctx, type: "stock",
    texte: `Stock ${delta > 0 ? "+" : ""}${delta} : ${piece.designation} (${piece.vehicule}) → ${rows[0].qte}` });
}

export async function listerPieces(user, f = {}) {
  exiger(user, "pieces.lire");
  const cond = [], p = [];
  if (f.statut)   { p.push(f.statut); cond.push(`statut = $${p.length}`); }
  if (f.commande) { p.push(f.commande); cond.push(`commande = $${p.length}`); }
  if (f.vehicule) { p.push(`%${f.vehicule}%`); cond.push(`vehicule ILIKE $${p.length}`); }
  if (f.texte) {
    p.push(`%${f.texte}%`);
    cond.push(`(designation ILIKE $${p.length} OR ref ILIKE $${p.length} OR vin ILIKE $${p.length} OR vehicule ILIKE $${p.length} OR note ILIKE $${p.length} OR fournisseur ILIKE $${p.length})`);
  }
  const { rows } = await query(
    `SELECT p.*, u.nom AS updated_by_nom FROM pieces p LEFT JOIN utilisateurs u ON u.id = p.updated_by
     ${cond.length ? "WHERE " + cond.join(" AND ") : ""} ORDER BY commande, ordre, id LIMIT ${Math.min(Number(f.limite) || 500, 1000)}`, p);
  return rows;
}

export async function creerPiece(user, data, source = "web") {
  exiger(user, "pieces.creer");
  const o = nettoyer({ statut: "demandee", ...data });
  if (!o.commande || !o.vehicule || !o.designation) throw Object.assign(new Error("Commande, véhicule et désignation sont obligatoires."), { status: 400 });
  if (o.statut === "validee") exiger(user, "pieces.valider");
  return tx(async c => {
    const cols = Object.keys(o);
    const { rows } = await c.query(
      `INSERT INTO pieces (${cols.join(",")},updated_by,ordre) VALUES (${cols.map((_, i) => "$" + (i + 1)).join(",")},$${cols.length + 1},(SELECT COALESCE(MAX(ordre),0)+1 FROM pieces)) RETURNING *`,
      [...cols.map(k => o[k]), user.id]);
    const ctx = { source, userId: user.id };
    await journal(c, { ...ctx, texte: `Ajout : ${o.designation} (${o.vehicule}) — ${o.qte ?? 1} × ${STATUTS[rows[0].statut]}` });
    await mouvementStock(c, rows[0], "demandee", rows[0].statut, ctx);
    return rows[0];
  });
}

export async function modifierPiece(user, id, data, source = "web") {
  const o = nettoyer(data);
  return tx(async c => {
    const { rows: [avant] } = await c.query("SELECT * FROM pieces WHERE id = $1 FOR UPDATE", [id]);
    if (!avant) throw Object.assign(new Error("Pièce introuvable."), { status: 404 });
    const nouveauStatut = o.statut ?? avant.statut;
    const autresChamps = Object.keys(o).filter(k => k !== "statut" && String(o[k] ?? "") !== String(avant[k] ?? ""));
    if (autresChamps.length) exiger(user, "pieces.modifier");
    exigerStatut(user, avant.statut, nouveauStatut);

    const cols = Object.keys(o);
    if (!cols.length) return avant;
    const { rows: [apres] } = await c.query(
      `UPDATE pieces SET ${cols.map((k, i) => `${k} = $${i + 1}`).join(", ")}, updated_at = now(), updated_by = $${cols.length + 1}
       WHERE id = $${cols.length + 2} RETURNING *`, [...cols.map(k => o[k]), user.id, id]);
    const ctx = { source, userId: user.id };
    if (avant.statut !== apres.statut) {
      await journal(c, { ...ctx, texte: `${apres.designation} (${apres.vehicule}) : ${STATUTS[avant.statut]} → ${STATUTS[apres.statut]}` });
      // si la quantité change en même temps, on retire l'ancienne et ajoute la nouvelle
      await mouvementStock(c, avant, avant.statut, "demandee", ctx);
      await mouvementStock(c, apres, "demandee", apres.statut, ctx);
    } else if (autresChamps.length) {
      await journal(c, { ...ctx, texte: `${apres.designation} (${apres.vehicule}) modifiée : ${autresChamps.join(", ")}` });
      if (apres.statut === "recue" && avant.qte !== apres.qte) {
        await mouvementStock(c, avant, "recue", "demandee", ctx);
        await mouvementStock(c, apres, "demandee", "recue", ctx);
      }
    }
    return apres;
  });
}

export async function supprimerPiece(user, id, source = "web") {
  exiger(user, "pieces.supprimer");
  return tx(async c => {
    const { rows: [p] } = await c.query("DELETE FROM pieces WHERE id = $1 RETURNING *", [id]);
    if (!p) throw Object.assign(new Error("Pièce introuvable."), { status: 404 });
    const ctx = { source, userId: user.id };
    await journal(c, { ...ctx, texte: `Suppression : ${p.designation} (${p.vehicule})` });
    await mouvementStock(c, p, p.statut, "demandee", ctx);
    return p;
  });
}

// ---------- Stock ----------
export async function listerStock(user, f = {}) {
  exiger(user, "stock.lire");
  const p = [];
  let w = "";
  if (f.texte) { p.push(`%${f.texte}%`); w = "WHERE designation ILIKE $1 OR ref ILIKE $1 OR vehicule ILIKE $1 OR rayon ILIKE $1"; }
  const { rows } = await query(`SELECT * FROM stock ${w} ORDER BY vehicule, designation`, p);
  return rows;
}

export async function ajouterStock(user, data, source = "web") {
  exiger(user, "stock.modifier");
  const designation = String(data.designation || "").trim();
  if (!designation) throw Object.assign(new Error("Désignation obligatoire."), { status: 400 });
  const o = { designation, ref: String(data.ref || "").trim(), vehicule: String(data.vehicule || "").trim(),
    qte: Math.max(0, parseInt(data.qte, 10) || 0), seuil: Math.max(0, parseInt(data.seuil, 10) || 0), rayon: String(data.rayon || "").trim() };
  return tx(async c => {
    const { rows: [s] } = await c.query(
      `INSERT INTO stock (cle,designation,ref,vehicule,qte,seuil,rayon) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (cle) DO UPDATE SET qte = stock.qte + EXCLUDED.qte,
         seuil = CASE WHEN EXCLUDED.seuil > 0 THEN EXCLUDED.seuil ELSE stock.seuil END,
         rayon = CASE WHEN EXCLUDED.rayon <> '' THEN EXCLUDED.rayon ELSE stock.rayon END, updated_at = now()
       RETURNING *`, [cleStock(o), o.designation, o.ref, o.vehicule, o.qte, o.seuil, o.rayon]);
    await journal(c, { source, userId: user.id, type: "stock", texte: `Entrée en stock +${o.qte} : ${o.designation} → ${s.qte}` });
    return s;
  });
}

export async function modifierStock(user, id, data, source = "web") {
  exiger(user, "stock.modifier");
  return tx(async c => {
    const { rows: [avant] } = await c.query("SELECT * FROM stock WHERE id = $1 FOR UPDATE", [id]);
    if (!avant) throw Object.assign(new Error("Article introuvable."), { status: 404 });
    const n = {
      designation: data.designation !== undefined ? String(data.designation).trim() || avant.designation : avant.designation,
      ref: data.ref !== undefined ? String(data.ref).trim() : avant.ref,
      vehicule: data.vehicule !== undefined ? String(data.vehicule).trim() : avant.vehicule,
      qte: data.delta !== undefined ? Math.max(0, avant.qte + (parseInt(data.delta, 10) || 0))
         : data.qte !== undefined ? Math.max(0, parseInt(data.qte, 10) || 0) : avant.qte,
      seuil: data.seuil !== undefined ? Math.max(0, parseInt(data.seuil, 10) || 0) : avant.seuil,
      rayon: data.rayon !== undefined ? String(data.rayon).trim() : avant.rayon,
    };
    const { rows: [s] } = await c.query(
      `UPDATE stock SET designation=$1, ref=$2, vehicule=$3, qte=$4, seuil=$5, rayon=$6, updated_at=now() WHERE id=$7 RETURNING *`,
      [n.designation, n.ref, n.vehicule, n.qte, n.seuil, n.rayon, id]);
    const d = s.qte - avant.qte;
    await journal(c, { source, userId: user.id, type: "stock",
      texte: d ? `Stock ${d > 0 ? "+" : ""}${d} : ${s.designation} → ${s.qte}${data.motif ? ` (${String(data.motif).slice(0, 120)})` : ""}` : `Article de stock modifié : ${s.designation}` });
    return s;
  });
}

export async function supprimerStock(user, id, source = "web") {
  exiger(user, "stock.modifier");
  return tx(async c => {
    const { rows: [s] } = await c.query("DELETE FROM stock WHERE id = $1 RETURNING *", [id]);
    if (!s) throw Object.assign(new Error("Article introuvable."), { status: 404 });
    await journal(c, { source, userId: user.id, type: "stock", texte: `Article retiré du stock : ${s.designation}` });
    return s;
  });
}

// ---------- Synthèse et historique ----------
export async function resume(user) {
  exiger(user, "pieces.lire");
  const [statuts, alertes, vehicules, stockBas] = await Promise.all([
    query("SELECT statut, COUNT(*)::int n FROM pieces GROUP BY statut"),
    query(`SELECT
      COUNT(*) FILTER (WHERE prix IS NULL AND designation <> 'Main d''œuvre')::int sans_prix,
      COUNT(*) FILTER (WHERE ref = '')::int sans_ref,
      COUNT(*) FILTER (WHERE date_prevue < CURRENT_DATE AND statut NOT IN ('recue','montee'))::int en_retard
      FROM pieces`),
    query(`SELECT vehicule, COUNT(*)::int lignes,
      COUNT(*) FILTER (WHERE statut IN ('recue','montee'))::int recues,
      COALESCE(SUM(prix*qte),0)::bigint montant FROM pieces GROUP BY vehicule ORDER BY vehicule`),
    query("SELECT COUNT(*)::int n FROM stock WHERE seuil > 0 AND qte <= seuil"),
  ]);
  return {
    statuts: Object.fromEntries(statuts.rows.map(r => [r.statut, r.n])),
    alertes: { ...alertes.rows[0], stock_bas: stockBas.rows[0].n },
    vehicules: vehicules.rows.map(v => ({ ...v, montant: Number(v.montant) })),
  };
}

export async function historique(user, { type, limite = 50 } = {}) {
  exiger(user, "pieces.lire");
  const p = [], w = type ? (p.push(type), "WHERE h.type = $1") : "";
  const { rows } = await query(
    `SELECT h.*, u.nom FROM historique h LEFT JOIN utilisateurs u ON u.id = h.user_id ${w} ORDER BY at DESC LIMIT ${Math.min(Number(limite) || 50, 200)}`, p);
  return rows;
}
