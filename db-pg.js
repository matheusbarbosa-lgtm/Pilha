// Adaptador PostgreSQL compatível com a interface sqlite (db.get/all/run/exec)
// Usado quando DATABASE_URL está definido (Supabase / Postgres)
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("[db-pg] DATABASE_URL não configurada no .env");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => console.error("[db-pg] pool error:", err.message));

// Converte SQL SQLite → PostgreSQL:
//   1. datetime('now') → NOW()
//   2. expires_at > NOW() / expires_at < NOW() → cast TEXT→timestamptz
//   3. INSERT OR IGNORE INTO → INSERT INTO ... ON CONFLICT DO NOTHING
//   4. ? placeholders → $1, $2, ...
function transformSql(sql) {
  sql = sql.replace(/datetime\('now'\)/gi, "NOW()");

  // expires_at é TEXT no schema; precisa de cast para comparar com NOW() (timestamptz)
  sql = sql.replace(/\bexpires_at\s*>\s*NOW\(\)/gi, "expires_at::timestamptz > NOW()");
  sql = sql.replace(/\bexpires_at\s*<\s*NOW\(\)/gi, "expires_at::timestamptz < NOW()");

  const hasOrIgnore = /\bINSERT OR IGNORE\b/i.test(sql);
  sql = sql.replace(/\bINSERT OR IGNORE\b/gi, "INSERT");

  let i = 0;
  sql = sql.replace(/\?/g, () => `$${++i}`);

  if (hasOrIgnore) {
    if (/\bRETURNING\b/i.test(sql)) {
      sql = sql.replace(/\s*\bRETURNING\b/i, " ON CONFLICT DO NOTHING RETURNING");
    } else {
      sql = sql.trimEnd().replace(/;?\s*$/, "") + " ON CONFLICT DO NOTHING";
    }
  }

  return sql;
}

function wrapPool(pool) {
  return {
    // Retorna a primeira linha ou undefined
    async get(sql, params = []) {
      const res = await pool.query(transformSql(sql), params);
      return res.rows[0];
    },

    // Retorna todas as linhas
    async all(sql, params = []) {
      const res = await pool.query(transformSql(sql), params);
      return res.rows;
    },

    // Executa INSERT/UPDATE/DELETE; retorna { lastID, changes }
    async run(sql, params = []) {
      let pgSql = transformSql(sql);
      // Adiciona RETURNING id em INSERTs que ainda não têm
      if (/^\s*INSERT\b/i.test(pgSql) && !/\bRETURNING\b/i.test(pgSql)) {
        pgSql = pgSql.trimEnd().replace(/;?\s*$/, "") + " RETURNING id";
      }
      const res = await pool.query(pgSql, params);
      return {
        lastID: res.rows[0]?.id ?? null,
        changes: res.rowCount ?? 0,
      };
    },

    // Executa SQL sem parâmetros (multi-statement ok)
    async exec(sql) {
      const pgSql = sql.replace(/datetime\('now'\)/gi, "NOW()");
      await pool.query(pgSql);
    },
  };
}

const db = wrapPool(pool);

// evalDb aponta para o mesmo pool — tabelas de avaliação estão no mesmo banco
const evalDb = wrapPool(pool);

async function initDb() {
  // Testa a conexão na inicialização
  await pool.query("SELECT 1");
  console.log("[db-pg] Conectado ao PostgreSQL (Supabase)");
  return db;
}

async function initEvalDb() {
  return evalDb;
}

module.exports = { initDb, initEvalDb, db, evalDb, pool };
