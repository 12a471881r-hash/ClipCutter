const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
