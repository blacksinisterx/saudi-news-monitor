import { readFileSync } from "node:fs";
import { sql } from "../lib/db";
import { seedSources } from "../lib/sources";

await sql.unsafe(readFileSync("db/schema.sql", "utf8"));
await seedSources();
console.log("Schema applied and sources seeded.");
await sql.end();
