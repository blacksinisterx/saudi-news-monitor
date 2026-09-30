import { sql } from "./db";

export async function log(level: "info" | "warn" | "error", stage: string, message: string, meta?: Record<string, unknown>, sourceId?: string) {
  console[level === "error" ? "error" : "log"](`[${stage}] ${message}`);
  try {
    await sql`insert into processing_logs (level, stage, source_id, message, meta) values (${level}, ${stage}, ${sourceId ?? null}, ${message.slice(0, 500)}, ${meta ? sql.json(meta as never) : null})`;
  } catch {
    /* logging must never break the pipeline */
  }
}
