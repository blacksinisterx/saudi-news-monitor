// Zero-install local Postgres (PGlite) on 127.0.0.1:5433. Data persists in ./.pglite
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const db = await PGlite.create("./.pglite");
const server = new PGLiteSocketServer({ db, port: 5433, host: "127.0.0.1" });
await server.start();
console.log("Local Postgres (PGlite) listening on postgres://postgres:postgres@127.0.0.1:5433/postgres");
