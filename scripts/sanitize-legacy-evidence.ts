import { fileURLToPath } from "node:url";
import type { PoolClient, QueryResultRow } from "pg";
import { createDatabasePool, formatSafeError, readDatabaseConfig } from "./migrate.js";
import { EVIDENCE_IMAGE_NORMALIZATION_VERSION, normalizeEvidenceImage } from "../src/server/evidence-images.js";

const advisoryLockKey = 20603019;
const defaultBatchSize = 25;

const evidenceTables = [
  "expense_receipts",
  "repayment_proofs",
  "group_expense_receipts",
  "group_settlement_proofs",
] as const;

type EvidenceTable = (typeof evidenceTables)[number];

type LegacyEvidenceRow = QueryResultRow & {
  id: string;
  original_filename: string;
  media_type: string;
  byte_size: number;
  sha256: string;
  content: Buffer;
};

export type EvidenceBackfillTableSummary = { converted: number; alreadyCurrent: number };
export type EvidenceBackfillSummary = Record<EvidenceTable, EvidenceBackfillTableSummary>;

export class EvidenceBackfillRowError extends Error {
  constructor(readonly table: EvidenceTable, readonly rowId: string, readonly summary: EvidenceBackfillSummary) {
    super(`evidence normalization failed for ${table} row ${rowId}`);
    this.name = "EvidenceBackfillRowError";
  }
}

export function validateEvidenceBackfillEnvironment(environment: Record<string, string | undefined>) {
  const databaseName = environment.DB_NAME?.trim();
  if (!databaseName) throw new Error("DB_NAME must explicitly identify the evidence backfill target");
  if (!/^[a-zA-Z0-9_]+$/u.test(databaseName)) throw new Error("DB_NAME contains unsupported characters");
  if (environment.ZPLIT_EVIDENCE_BACKFILL_CONFIRM?.trim() !== `${databaseName}:sanitize-evidence`) {
    throw new Error(`ZPLIT_EVIDENCE_BACKFILL_CONFIRM must equal ${databaseName}:sanitize-evidence`);
  }
  return databaseName;
}

function emptySummary(): EvidenceBackfillSummary {
  return Object.fromEntries(evidenceTables.map((table) => [table, { converted: 0, alreadyCurrent: 0 }])) as EvidenceBackfillSummary;
}

async function countCurrentRows(client: PoolClient, table: EvidenceTable) {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "${table}" WHERE normalization_version >= $1`,
    [EVIDENCE_IMAGE_NORMALIZATION_VERSION],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function normalizeBatch(client: PoolClient, table: EvidenceTable, batchSize: number, summary: EvidenceBackfillSummary) {
  await client.query("BEGIN");
  let converted = 0;
  try {
    const selected = await client.query<LegacyEvidenceRow>(
      `SELECT id, original_filename, media_type, byte_size, sha256, content FROM "${table}" WHERE normalization_version = 0 ORDER BY id LIMIT $1 FOR UPDATE`,
      [batchSize],
    );
    for (const row of selected.rows) {
      let normalized;
      try {
        normalized = await normalizeEvidenceImage({
          originalFilename: row.original_filename,
          mediaType: row.media_type as "image/jpeg" | "image/png" | "image/webp",
          byteSize: row.byte_size,
          sha256: row.sha256,
          content: Buffer.from(row.content),
        });
      } catch {
        throw new EvidenceBackfillRowError(table, row.id, summary);
      }
      const updated = await client.query(
        `UPDATE "${table}" SET original_filename = $1, media_type = $2, byte_size = $3, sha256 = $4, content = $5, normalization_version = $6 WHERE id = $7 AND normalization_version = 0`,
        [
          normalized.originalFilename,
          normalized.mediaType,
          normalized.byteSize,
          normalized.sha256,
          normalized.content,
          EVIDENCE_IMAGE_NORMALIZATION_VERSION,
          row.id,
        ],
      );
      if (updated.rowCount !== 1) throw new Error("evidence backfill lost a locked row");
      converted += 1;
    }
    await client.query("COMMIT");
    return { selected: selected.rowCount ?? selected.rows.length, converted };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function runEvidenceImageBackfill(client: PoolClient, batchSize = defaultBatchSize) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error("batch size must be between 1 and 500");
  const summary = emptySummary();
  await client.query("SELECT pg_advisory_lock($1::bigint)", [advisoryLockKey]);
  try {
    for (const table of evidenceTables) {
      summary[table].alreadyCurrent = await countCurrentRows(client, table);
      while (true) {
        const batch = await normalizeBatch(client, table, batchSize, summary);
        summary[table].converted += batch.converted;
        if (batch.selected === 0) break;
      }
    }
    return summary;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1::bigint)", [advisoryLockKey]);
  }
}

export async function runEvidenceBackfillCommand(environment = process.env) {
  validateEvidenceBackfillEnvironment(environment);
  const config = readDatabaseConfig();
  const pool = createDatabasePool(config);
  let failure: unknown;
  try {
    const client = await pool.connect();
    try {
      const result = await client.query<{ database: string }>("SELECT current_database() AS database");
      if (result.rows[0]?.database !== config.database) throw new Error("connected database did not match DB_NAME");
      const summary = await runEvidenceImageBackfill(client);
      for (const table of evidenceTables) {
        console.log(`${table}: converted=${summary[table].converted} already-current=${summary[table].alreadyCurrent}`);
      }
    } finally {
      client.release();
    }
  } catch (error) {
    failure = error;
  } finally {
    await pool.end();
  }
  if (failure) {
    if (failure instanceof EvidenceBackfillRowError) {
      for (const table of evidenceTables) {
        console.log(`${table}: converted=${failure.summary[table].converted} already-current=${failure.summary[table].alreadyCurrent}`);
      }
      console.error(`${failure.message}; batch rolled back, original row remains unchanged; manual remediation required`);
    } else {
      console.error(`evidence backfill failed: ${formatSafeError(failure, config.password)}`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void runEvidenceBackfillCommand();
