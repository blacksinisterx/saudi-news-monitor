import postgres from "postgres";

const g = globalThis as unknown as { _sql?: postgres.Sql };

export const sql =
  g._sql ??
  (g._sql = postgres(process.env.DATABASE_URL ?? "", {
    max: 1, // one connection per serverless instance; PGlite (local) is single-connection too
    prepare: false, // required for Supabase transaction pooler
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  }));
