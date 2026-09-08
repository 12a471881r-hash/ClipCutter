const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

async function main() {
  const connectionString =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL;
  const isLocal = connectionString?.includes("localhost") ?? false;

  const pool = new Pool({
    connectionString,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
  const schema = fs.readFileSync(
    path.join(__dirname, "..", "db", "schema.sql"),
    "utf8"
  );
  await pool.query(schema);
  console.log("Schema applicato con successo.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
