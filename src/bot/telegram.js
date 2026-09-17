import { Bot, InlineKeyboard } from "grammy";
import { query } from "../db.js";
import { trouverParTelegram, lierTelegram } from "../services/utilisateurs.js";
import { repondre, executerAction } from "../ai/agent.js";

const memoires = new Map();      // chatId -> derniers messages (texte seulement)
const MAX_MEMO = 12;

export function creerBot() {
  if (!process.env.TELEGRAM_BOT_TOKEN) { console.warn("TELEGRAM_BOT_TOKEN absent : bot désactivé."); return null; }
  const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

  bot.command("start", async ctx => {
    const code = ctx.match?.trim();
    if (code) return lier(ctx, code);
    const u = await trouverParTelegram(ctx.from.id);
    return ctx.reply(u
      ? `Bonjour ${u.nom} 👋\nÉcrivez-moi ou envoyez une photo. Exemples :\n• Qu'est-ce qui manque pour la Haval ?\n• Reçu les 12 injecteurs Rich 6\n• Combien de phares Dongfeng en stock ?\n\n/oublier pour repartir de zéro.`
      : "Bonjour. Pour utiliser ce bot, connectez-vous sur le site, cliquez sur « Lier Telegram » et envoyez ici : /lier 123456");
  });
  bot.command("lier", ctx => lier(ctx, ctx.match?.trim()));
  bot.command("oublier", ctx => { memoires.delete(ctx.chat.id); return ctx.reply("Conversation remise à zéro."); });

  // Toute autre interaction exige un compte lié et actif.
  bot.use(async (ctx, next) => {
    if (!ctx.from) return;
    const u = await trouverParTelegram(ctx.from.id);
    if (!u) return ctx.reply("Compte non lié. Sur le site : « Lier Telegram », puis envoyez /lier CODE.");
    ctx.utilisateur = u;
    return next();
  });

  bot.callbackQuery(/^(ok|non):(.+)$/, async ctx => {
    const [, choix, id] = ctx.match;
    const { rows: [a] } = await query(
      "UPDATE actions_en_attente SET statut = $1 WHERE id = $2 AND user_id = $3 AND statut = 'attente' AND created_at > now() - interval '1 hour' RETURNING *",
      [choix === "ok" ? "executee" : "annulee", id, ctx.utilisateur.id]);
    await ctx.answerCallbackQuery();
    if (!a) return ctx.editMessageReplyMarkup().catch(() => {}).then(() => ctx.reply("Action expirée ou déjà traitée."));
    if (choix === "non") return ctx.editMessageText(`❌ Annulé\n${a.resume}`);
    try {
      const res = await executerAction(ctx.utilisateur, a.action);
      await ctx.editMessageText(`${res}\n${a.resume}`);
    } catch (e) {
      await query("UPDATE actions_en_attente SET statut = 'annulee' WHERE id = $1", [id]);
      await ctx.editMessageText(`⚠️ Échec : ${e.status ? e.message : "erreur serveur"}\n${a.resume}`);
      if (!e.status) console.error(e);
    }
  });

  bot.on(["message:text", "message:photo", "message:document"], async ctx => {
    const u = ctx.utilisateur;
    const images = [];
    try {
      const photo = ctx.message.photo?.at(-1) || (ctx.message.document?.mime_type?.startsWith("image/") ? ctx.message.document : null);
      if (photo) {
        if (photo.file_size > 8e6) return ctx.reply("Image trop lourde (8 Mo max).");
        const f = await ctx.api.getFile(photo.file_id);
        const r = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${f.file_path}`);
        const mime = ctx.message.document?.mime_type || "image/jpeg";
        images.push(`data:${mime};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`);
      }
      await ctx.replyWithChatAction("typing");
      const texte = ctx.message.text || ctx.message.caption || "";
      const { texte: reponse, propositions, memo } = await repondre(u, memoires.get(ctx.chat.id) || [], { texte, images });
      memoires.set(ctx.chat.id, memo.slice(-MAX_MEMO));
      await ctx.reply(reponse.slice(0, 4000));
      for (const p of propositions)
        await ctx.reply(`À confirmer :\n${p.resume}`.slice(0, 4000),
          { reply_markup: new InlineKeyboard().text("✅ Confirmer", `ok:${p.id}`).text("❌ Annuler", `non:${p.id}`) });
    } catch (e) {
      console.error("Erreur agent:", e);
      await ctx.reply("⚠️ L'assistant est indisponible pour le moment. Réessayez dans un instant, ou utilisez le site.");
    }
  });

  bot.catch(err => console.error("Erreur bot:", err.error));
  return bot;
}

async function lier(ctx, code) {
  if (!code) return ctx.reply("Envoyez /lier suivi du code à 6 chiffres affiché sur le site.");
  const u = await lierTelegram(code, ctx.from.id);
  if (!u) return ctx.reply("Code invalide ou expiré (10 minutes). Générez-en un nouveau sur le site.");
  await query("INSERT INTO historique (texte,type,source,user_id) VALUES ($1,'utilisateur','telegram',$2)", [`${u.nom} a lié son compte Telegram`, u.id]);
  return ctx.reply(`✅ Compte lié : ${u.nom} (${u.role}). Vous pouvez maintenant m'écrire.`);
}
