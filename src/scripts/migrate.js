import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "db");
for (let i = 0; ; i++) {
  try { await pool.query("SELECT 1"); break; }
  catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 2000)); }
}
await pool.query(await fs.readFile(path.join(dir, "schema.sql"), "utf8"));
const { rows } = await pool.query("SELECT COUNT(*)::int n FROM pieces");
if (rows[0].n === 0 && process.env.SEED !== "non") {
  await pool.query(await fs.readFile(path.join(dir, "seed.sql"), "utf8"));
  console.log("Données initiales importées.");
}
console.log("Base de données à jour.");
await pool.end();
