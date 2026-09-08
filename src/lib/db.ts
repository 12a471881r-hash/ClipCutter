import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
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
