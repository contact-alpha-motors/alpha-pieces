import pg from "pg";
pg.types.setTypeParser(1700, v => (v === null ? null : Number(v))); // NUMERIC -> number
pg.types.setTypeParser(1082, v => v);                                // DATE -> 'YYYY-MM-DD'

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

export const query = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await fn(client);
    await client.query("COMMIT");
    return res;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
