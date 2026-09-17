import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webhookCallback } from "grammy";
import api from "./routes/api.js";
import { creerBot } from "./bot/telegram.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: { directives: {
  "default-src": ["'self'"], "script-src": ["'self'"], "style-src": ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
  "font-src": ["'self'", "https://fonts.gstatic.com"], "img-src": ["'self'", "data:"] } } }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

const bot = creerBot();
if (bot) {
  if (process.env.TELEGRAM_MODE === "polling") {
    bot.start({ onStart: i => console.log(`Bot @${i.username} en mode polling`) });
  } else {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    app.post("/telegram/webhook", webhookCallback(bot, "express", { secretToken: secret }));
    bot.init().then(async () => {
      process.env.TELEGRAM_BOT_USERNAME = bot.botInfo.username;
      if (process.env.PUBLIC_URL) {
        await bot.api.setWebhook(`${process.env.PUBLIC_URL}/telegram/webhook`, { secret_token: secret, drop_pending_updates: true });
        console.log(`Bot @${bot.botInfo.username} : webhook actif`);
      }
    }).catch(e => console.error("Initialisation du bot impossible :", e.message));
  }
}

app.get("/sante", (req, res) => res.json({ ok: true }));
app.use("/api", api);
app.use(express.static(path.join(dir, "..", "public"), { extensions: ["html"] }));
app.get("*", (req, res) => res.sendFile(path.join(dir, "..", "public", "index.html")));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Alpha Pièces sur le port ${port}`));
