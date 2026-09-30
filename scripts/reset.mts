import { sql } from "../lib/db";
await sql`truncate articles, events, event_sources, notifications, processing_logs restart identity cascade`;
await sql`update sources set last_attempt_at = null, last_success_at = null, consecutive_failures = 0, last_error = null, etag = null, last_modified = null, articles_total = 0`;
console.log("data reset"); await sql.end();
