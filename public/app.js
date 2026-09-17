const STATUTS = [
  { k: "demandee", l: "Demandée", c: "--s0" }, { k: "devis", l: "Devis reçu", c: "--s1" },
  { k: "validee", l: "Validée", c: "--s2" }, { k: "commandee", l: "Commandée", c: "--s3" },
  { k: "recue", l: "Reçue", c: "--s4" }, { k: "montee", l: "Montée", c: "--s5" }];
const SL = Object.fromEntries(STATUTS.map(s => [s.k, s]));
const DROITS = {
  pieces_creer: ["admin", "boss", "magasinier"], pieces_modifier: ["admin", "boss", "magasinier"],
  pieces_supprimer: ["admin", "boss"], pieces_valider: ["admin", "boss"],
  stock_modifier: ["admin", "boss", "magasinier"], usr: ["admin"] };

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => n == null ? "—" : Number(n).toLocaleString("fr-FR") + " F";
const today = () => new Date().toISOString().slice(0, 10);
const late = p => p.date_prevue && p.date_prevue < today() && !["recue", "montee"].includes(p.statut);

let moi = null, pieces = [], stock = [], resume = null, filt = null, onglet = "cmd", editP = null, editS = null, editU = null;
const peut = d => moi && DROITS[d].includes(moi.role);
const statutsPermis = actuel => STATUTS.filter(s => s.k === actuel ||
  (moi.role === "atelier" ? (actuel === "recue" && s.k === "montee") : peut("pieces_modifier") && (s.k !== "validee" || peut("pieces_valider"))));

function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 3000); }

async function api(url, opts = {}) {
  const r = await fetch("/api" + url, { ...opts, headers: { "Content-Type": "application/json" }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== "/connexion") { afficherLogin(); throw new Error(d.erreur); }
  if (!r.ok) throw new Error(d.erreur || "Erreur");
  return d;
}

// ---------- Session ----------
function afficherLogin() { moi = null; $("ecran-app").hidden = true; $("ecran-login").hidden = false; }
$("f-login").onsubmit = async e => {
  e.preventDefault(); $("login-err").textContent = "";
  try { await api("/connexion", { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); demarrer(); }
  catch (err) { $("login-err").textContent = err.message; }
};
$("b-sortir").onclick = async () => { await api("/deconnexion", { method: "POST" }).catch(() => {}); afficherLogin(); };

async function demarrer() {
  try { moi = await api("/moi"); } catch { return afficherLogin(); }
  $("ecran-login").hidden = true; $("ecran-app").hidden = false;
  $("me-nom").textContent = moi.nom; $("me-role").textContent = moi.role;
  $("tab-usr").hidden = !peut("usr"); $("b-add").hidden = !peut("pieces_creer"); $("b-sadd").hidden = !peut("stock_modifier");
  charger();
}

// ---------- Chargement ----------
async function charger() {
  if (!moi) return;
  try {
    const t = onglet;
    if (t === "cmd") { [pieces, resume] = await Promise.all([api("/pieces"), api("/resume")]); rendrePieces(); }
    if (t === "stk") { stock = await api("/stock"); rendreStock(); }
    if (t === "his") rendreHistorique(await api("/historique?limite=150" + ($("htype").value ? "&type=" + $("htype").value : "")));
    if (t === "usr") rendreUsers(await api("/utilisateurs"));
  } catch (e) { if (moi) toast(e.message); }
}
setInterval(() => { if (!document.hidden && !document.querySelector("dialog[open]")) charger(); }, 20000);

document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
  onglet = b.dataset.tab;
  document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", x === b));
  for (const v of ["cmd", "stk", "his", "usr"]) $("v-" + v).hidden = v !== onglet;
  charger();
});

// ---------- Commandes ----------
function rendrePieces() {
  const n = resume.statuts;
  $("flow").innerHTML = STATUTS.map(s => `<button style="--c:var(${s.c})" aria-pressed="${filt === s.k}" data-s="${s.k}"><span class="num">${n[s.k] || 0}</span><small>${s.l}</small></button>`).join("");
  $("flow").querySelectorAll("button").forEach(b => b.onclick = () => { filt = filt === b.dataset.s ? null : b.dataset.s; rendrePieces(); });
  const a = resume.alertes;
  $("alerts").innerHTML = `${a.en_retard ? `<span class="alert"><b>${a.en_retard}</b> en retard</span>` : ""}<span class="alert"><b>${a.sans_prix}</b> sans prix confirmé</span><span class="alert"><b>${a.sans_ref}</b> sans référence</span>${a.stock_bas ? `<span class="alert"><b>${a.stock_bas}</b> stock sous le seuil</span>` : ""}`;
  const cmds = [...new Set(pieces.map(p => p.commande))].sort(), cur = $("fcmd").value;
  $("fcmd").innerHTML = `<option value="">Toutes les commandes</option>` + cmds.map(c => `<option ${c === cur ? "selected" : ""}>${esc(c)}</option>`).join("");
  $("l-cmds").innerHTML = cmds.map(c => `<option value="${esc(c)}">`).join("");

  const q = $("q").value.toLowerCase().trim();
  const rows = pieces.filter(p => (!filt || p.statut === filt) && (!$("fcmd").value || p.commande === $("fcmd").value) &&
    (!q || [p.designation, p.vehicule, p.vin, p.ref, p.commande, p.fournisseur, p.note].join(" ").toLowerCase().includes(q)));
  const groupes = {}; rows.forEach(p => (groupes[p.commande + "\u0000" + p.vehicule] ??= []).push(p));
  let h = `<table><thead><tr><th>Pièce</th><th>VIN</th><th class="r">Qté</th><th class="r">Prix unit.</th><th class="r">Total</th><th>Statut</th><th>Mise à jour</th></tr></thead><tbody>`;
  for (const [k, list] of Object.entries(groupes)) {
    const [c, v] = k.split("\u0000"), tot = list.reduce((s, p) => s + (p.prix || 0) * p.qte, 0);
    h += `<tr class="group"><td colspan="7">${esc(v)} <span>· ${esc(c)} · ${list.length} ligne(s) · ${fmt(tot)}</span></td></tr>`;
    for (const p of list) {
      const s = SL[p.statut], opts = statutsPermis(p.statut);
      h += `<tr><td><button class="link" data-e="${p.id}">${esc(p.designation)}</button>
        <div class="ref">${esc(p.ref || "réf. à confirmer")}${p.emplacement ? " · " + esc(p.emplacement) : ""}${p.fournisseur ? " · " + esc(p.fournisseur) : ""}</div>
        ${p.note ? `<div class="ref">${esc(p.note)}</div>` : ""}${late(p) ? `<div class="late">En retard (prévu ${p.date_prevue})</div>` : ""}</td>
        <td class="ref">${esc(p.vin || "—")}</td><td class="r">${p.qte} ${esc(p.unite)}</td><td class="r">${fmt(p.prix)}</td>
        <td class="r">${p.prix ? fmt(p.prix * p.qte) : "—"}</td>
        <td><select class="st" style="--c:var(${s.c})" data-s="${p.id}" ${opts.length < 2 ? "disabled" : ""} aria-label="Statut">${opts.map(x => `<option value="${x.k}" ${x.k === p.statut ? "selected" : ""}>${x.l}</option>`).join("")}</select></td>
        <td class="ref">${new Date(p.updated_at).toLocaleDateString("fr-FR")}<br>${esc(p.updated_by_nom || "")}</td></tr>`;
    }
  }
  $("t-pieces").className = rows.length ? "" : "state";
  $("t-pieces").innerHTML = rows.length ? h + "</tbody></table>" : "Aucune pièce ne correspond.";
  $("t-pieces").querySelectorAll("select.st").forEach(sel => sel.onchange = async () => {
    try { await api("/pieces/" + sel.dataset.s, { method: "PATCH", body: { statut: sel.value } }); toast("Statut mis à jour"); }
    catch (e) { toast(e.message); } charger();
  });
  $("t-pieces").querySelectorAll("[data-e]").forEach(b => b.onclick = () => ouvrirPiece(pieces.find(p => p.id == b.dataset.e)));
  $("vehs").innerHTML = resume.vehicules.map(v => `<div class="veh"><span>${esc(v.vehicule)}</span><span class="ref">${v.recues}/${v.lignes} reçues · ${fmt(v.montant)}</span></div><div class="meter"><i style="width:${v.lignes ? v.recues / v.lignes * 100 : 0}%"></i></div>`).join("");
}
$("q").oninput = rendrePieces; $("fcmd").onchange = rendrePieces;
$("b-clear").onclick = () => { filt = null; $("q").value = ""; $("fcmd").value = ""; rendrePieces(); };
$("b-add").onclick = () => ouvrirPiece(null);

function ouvrirPiece(p) {
  editP = p; const f = $("f-piece"); f.reset(); $("piece-err").textContent = "";
  $("d-piece-t").textContent = p ? "Modifier la pièce" : "Nouvelle pièce";
  const d = p || { statut: "demandee", commande: $("fcmd").value, qte: 1 };
  $("s-statut").innerHTML = (p ? statutsPermis(p.statut) : STATUTS.filter(s => s.k !== "validee" || peut("pieces_valider"))).map(s => `<option value="${s.k}">${s.l}</option>`).join("");
  for (const el of f.elements) if (el.name && d[el.name] != null) el.value = d[el.name];
  const lecture = !peut("pieces_modifier");
  for (const el of f.elements) if (el.name && el.name !== "statut") el.disabled = lecture;
  $("b-pdel").hidden = !p || !peut("pieces_supprimer");
  $("d-piece").showModal();
}
$("f-piece").onsubmit = async e => {
  if (e.submitter?.value !== "ok") return;
  e.preventDefault();
  const body = Object.fromEntries([...new FormData(e.target)]);
  try {
    if (editP) await api("/pieces/" + editP.id, { method: "PATCH", body });
    else await api("/pieces", { method: "POST", body });
    $("d-piece").close(); toast("Enregistré"); charger();
  } catch (err) { $("piece-err").textContent = err.message; }
};
$("b-pdel").onclick = async () => {
  if (!editP || !confirm("Supprimer cette pièce ?")) return;
  try { await api("/pieces/" + editP.id, { method: "DELETE" }); $("d-piece").close(); charger(); } catch (e) { $("piece-err").textContent = e.message; }
};

// ---------- Stock ----------
function rendreStock() {
  const q = $("sq").value.toLowerCase().trim(), mod = peut("stock_modifier");
  const bas = stock.filter(s => s.seuil && s.qte <= s.seuil).length;
  $("salerts").innerHTML = `<span class="alert">${stock.length} articles</span><span class="alert">${stock.reduce((a, s) => a + s.qte, 0)} pièces</span><span class="alert"><b>${bas}</b> sous le seuil</span>`;
  const rows = stock.filter(s => !q || [s.designation, s.ref, s.vehicule, s.rayon].join(" ").toLowerCase().includes(q));
  if (!rows.length) { $("t-stock").className = "state"; $("t-stock").textContent = stock.length ? "Aucun article ne correspond." : "Stock vide pour l'instant."; return; }
  $("t-stock").className = "";
  $("t-stock").innerHTML = `<table style="min-width:620px"><thead><tr><th>Article</th><th>Véhicule</th><th>Emplacement</th><th class="r">Seuil</th><th>Quantité</th></tr></thead><tbody>${rows.map(s => {
    const cls = s.qte === 0 || (s.seuil && s.qte <= s.seuil) ? "low" : "ok";
    return `<tr><td><button class="link" data-se="${s.id}">${esc(s.designation)}</button><div class="ref">${esc(s.ref || "sans référence")}</div></td>
      <td>${esc(s.vehicule || "—")}</td><td class="ref">${esc(s.rayon || "—")}</td><td class="r ref">${s.seuil || "—"}</td>
      <td><span class="qty"><button class="btn" data-d="-1" data-id="${s.id}" ${mod ? "" : "hidden"} aria-label="Sortir une pièce">−</button><span class="num ${cls}" style="font-size:22px;min-width:28px;text-align:center">${s.qte}</span><button class="btn" data-d="1" data-id="${s.id}" ${mod ? "" : "hidden"} aria-label="Entrer une pièce">+</button></span></td></tr>`;
  }).join("")}</tbody></table>`;
  $("t-stock").querySelectorAll("[data-d]").forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { await api("/stock/" + b.dataset.id, { method: "PATCH", body: { delta: Number(b.dataset.d) } }); } catch (e) { toast(e.message); }
    charger();
  });
  $("t-stock").querySelectorAll("[data-se]").forEach(b => b.onclick = () => ouvrirStock(stock.find(s => s.id == b.dataset.se)));
}
$("sq").oninput = rendreStock;
$("b-sadd").onclick = () => ouvrirStock(null);
function ouvrirStock(s) {
  editS = s; const f = $("f-stock"); f.reset(); $("stock-err").textContent = "";
  $("d-stock-t").textContent = s ? "Modifier l'article" : "Ajouter au stock";
  if (s) for (const el of f.elements) if (el.name && s[el.name] != null) el.value = s[el.name];
  for (const el of f.elements) if (el.name) el.disabled = !peut("stock_modifier");
  $("b-sdel").hidden = !s || !peut("stock_modifier");
  $("d-stock").showModal();
}
$("f-stock").onsubmit = async e => {
  if (e.submitter?.value !== "ok") return;
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  try {
    if (editS) await api("/stock/" + editS.id, { method: "PATCH", body }); else await api("/stock", { method: "POST", body });
    $("d-stock").close(); toast("Stock mis à jour"); charger();
  } catch (err) { $("stock-err").textContent = err.message; }
};
$("b-sdel").onclick = async () => {
  if (!editS || !confirm("Supprimer cet article du stock ?")) return;
  try { await api("/stock/" + editS.id, { method: "DELETE" }); $("d-stock").close(); charger(); } catch (e) { $("stock-err").textContent = e.message; }
};

// ---------- Historique ----------
function rendreHistorique(list) {
  $("l-his").innerHTML = list.length ? list.map(h => `<div class="log">${esc(h.texte)}<em>${new Date(h.at).toLocaleString("fr-FR")} · ${esc(h.nom || "système")} <span class="tag">${h.source === "telegram" ? "Telegram" : h.source === "web" ? "Web" : "Système"}</span></em></div>`).join("") : `<div class="ref">Aucun événement.</div>`;
}
$("htype").onchange = charger;

// ---------- Utilisateurs ----------
function rendreUsers(list) {
  $("t-usr").innerHTML = `<table style="min-width:600px"><thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Telegram</th><th>État</th></tr></thead><tbody>${list.map(u =>
    `<tr><td><button class="link" data-u="${u.id}">${esc(u.nom)}</button></td><td class="ref">${esc(u.email)}</td><td>${esc(u.role)}</td><td>${u.telegram_lie ? "✅ lié" : "—"}</td><td>${u.actif ? "Actif" : `<span class="low">Désactivé</span>`}</td></tr>`).join("")}</tbody></table>`;
  $("t-usr").querySelectorAll("[data-u]").forEach(b => b.onclick = () => ouvrirUser(list.find(u => u.id == b.dataset.u)));
}
$("b-uadd").onclick = () => ouvrirUser(null);
function ouvrirUser(u) {
  editU = u; const f = $("f-usr"); f.reset(); $("usr-err").textContent = "";
  $("d-usr-t").textContent = u ? "Modifier l'utilisateur" : "Nouvel utilisateur";
  f.email.disabled = !!u; f.motDePasse.required = !u;
  $("u-mdp-l").textContent = u ? "Nouveau mot de passe (laisser vide pour ne pas changer)" : "Mot de passe (8 caractères min.)";
  $("u-delier").hidden = !u?.telegram_lie;
  if (u) { f.nom.value = u.nom; f.email.value = u.email; f.role.value = u.role; f.actif.value = String(u.actif); }
  $("d-usr").showModal();
}
$("f-usr").onsubmit = async e => {
  if (e.submitter?.value !== "ok") return;
  e.preventDefault();
  const f = e.target, body = { nom: f.nom.value, role: f.role.value, actif: f.actif.value === "true" };
  if (f.motDePasse.value) body.motDePasse = f.motDePasse.value;
  if (f.delierTelegram.checked) body.delierTelegram = true;
  try {
    if (editU) await api("/utilisateurs/" + editU.id, { method: "PATCH", body });
    else await api("/utilisateurs", { method: "POST", body: { ...body, email: f.email.value } });
    $("d-usr").close(); toast("Utilisateur enregistré"); charger();
  } catch (err) { $("usr-err").textContent = err.message; }
};

// ---------- Mon compte ----------
$("b-compte").onclick = () => {
  $("tg-etat").textContent = moi.telegram_lie ? "✅ Votre compte Telegram est lié. Générer un nouveau code remplacera la liaison." : "Liez Telegram pour enregistrer et consulter les pièces depuis votre téléphone.";
  $("tg-code").hidden = true; $("f-mdp").reset(); $("mdp-err").textContent = ""; $("d-compte").showModal();
};
$("b-compte-f").onclick = () => { $("d-compte").close(); demarrer(); };
$("b-tg").onclick = async () => {
  try {
    const { code, bot } = await api("/moi/telegram", { method: "POST" });
    $("tg-code-v").textContent = code; $("tg-code").hidden = false;
    $("tg-instr").innerHTML = `Dans Telegram, ouvrez ${bot ? `<a href="https://t.me/${esc(bot)}?start=${code}" target="_blank" rel="noopener">@${esc(bot)}</a> (le lien lie automatiquement)` : "le bot"} et envoyez <b>/lier ${code}</b>. Valable 10 minutes.`;
  } catch (e) { toast(e.message); }
};
$("f-mdp").onsubmit = async e => {
  e.preventDefault(); $("mdp-err").textContent = "";
  try { await api("/moi/mot-de-passe", { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast("Mot de passe modifié"); }
  catch (err) { $("mdp-err").textContent = err.message; }
};

demarrer();
