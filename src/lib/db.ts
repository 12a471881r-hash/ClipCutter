import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

function resolveConnectionString(): string | undefined {
  const raw = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    // Rimuoviamo sslmode dall'URL: decidiamo noi esplicitamente come gestire
    // l'SSL sotto, evitando che pg-connection-string lo tratti come
    // "verify-full" (causa errore self-signed certificate con Supabase).
    url.searchParams.delete("sslmode");
    url.searchParams.delete("supa");
    return url.toString();
  } catch {
    return raw;
  }
}

const connectionString = resolveConnectionString();
const isLocal = connectionString?.includes("localhost") ?? false;

export const pool =
  global.pgPool ??
  new Pool({
    connectionString,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== "production") {
  global.pgPool = pool;
}
