import { Pool } from "pg";

// Works with any standard Postgres connection string — Neon, Supabase,
// Render Postgres, Vercel Postgres (via its Postgres connection string), etc.
// Most hosted providers require SSL; rejectUnauthorized:false keeps this
// working across providers without needing their specific CA cert.
let pool;

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function ensureSchema() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS dispatch_snapshot (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      main_headline JSONB NOT NULL,
      stories JSONB NOT NULL,
      stock JSONB NOT NULL,
      podcast JSONB NOT NULL,
      trends JSONB NOT NULL,
      trends_created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Safe to run repeatedly — adds the column only if it's missing, so this
  // works on both a fresh table and your already-running database.
  await db.query(`
    ALTER TABLE dispatch_snapshot
    ADD COLUMN IF NOT EXISTS world_stories JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await db.query(`
    ALTER TABLE dispatch_snapshot
    ADD COLUMN IF NOT EXISTS stock_created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await db.query(`
    ALTER TABLE dispatch_snapshot
    ADD COLUMN IF NOT EXISTS podcast_created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
}

export async function getLatestSnapshot() {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT * FROM dispatch_snapshot ORDER BY created_at DESC LIMIT 1`
  );
  return rows[0] || null;
}

export async function insertSnapshot({
  mainHeadline,
  worldStories,
  stories,
  stock,
  stockCreatedAt,
  podcast,
  podcastCreatedAt,
  trends,
  trendsCreatedAt,
}) {
  const db = getPool();
  const { rows } = await db.query(
    `INSERT INTO dispatch_snapshot
      (main_headline, world_stories, stories, stock, stock_created_at, podcast, podcast_created_at, trends, trends_created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      JSON.stringify(mainHeadline),
      JSON.stringify(worldStories),
      JSON.stringify(stories),
      JSON.stringify(stock),
      stockCreatedAt,
      JSON.stringify(podcast),
      podcastCreatedAt,
      JSON.stringify(trends),
      trendsCreatedAt,
    ]
  );
  return rows[0];
}
