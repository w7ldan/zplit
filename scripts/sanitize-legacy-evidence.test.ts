import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { sha256Hex, validateReceiptFile } from "../src/domain/receipt-file";
import { EVIDENCE_IMAGE_NORMALIZATION_VERSION, normalizeEvidenceImage } from "../src/server/evidence-images";
import {
  EvidenceBackfillRowError,
  runEvidenceImageBackfill,
  validateEvidenceBackfillEnvironment,
} from "./sanitize-legacy-evidence";

vi.mock("server-only", () => ({}));
const { getSharedDebtorReceipt } = await import("../src/server/debtor-share-links");

const tables = ["expense_receipts", "repayment_proofs", "group_expense_receipts", "group_settlement_proofs"] as const;
type Table = (typeof tables)[number];

type Row = {
  id: string;
  original_filename: string;
  media_type: string;
  byte_size: number;
  sha256: string;
  content: Buffer;
  normalization_version: number;
  created_at: string;
  relationship_id: string;
};

function createClient(seed: Record<Table, Row[]>) {
  const rows = Object.fromEntries(tables.map((table) => [table, seed[table].map((row) => ({ ...row, content: Buffer.from(row.content) }))])) as Record<Table, Row[]>;
  let transactionSnapshot: Record<Table, Row[]> | undefined;
  let maximumSelected = 0;
  const cloneRows = () => Object.fromEntries(tables.map((table) => [table, rows[table].map((row) => ({ ...row, content: Buffer.from(row.content) }))])) as Record<Table, Row[]>;
  const client = {
    async query(statement: string, values: unknown[] = []) {
      const table = tables.find((name) => statement.includes(`"${name}"`));
      if (statement === "BEGIN") {
        transactionSnapshot = cloneRows();
        return { rows: [], rowCount: null };
      }
      if (statement === "COMMIT") {
        transactionSnapshot = undefined;
        return { rows: [], rowCount: null };
      }
      if (statement === "ROLLBACK") {
        if (transactionSnapshot) {
          for (const name of tables) rows[name] = transactionSnapshot[name];
        }
        transactionSnapshot = undefined;
        return { rows: [], rowCount: null };
      }
      if (statement.includes("pg_advisory_lock") || statement.includes("pg_advisory_unlock")) return { rows: [], rowCount: null };
      if (!table) throw new Error("unexpected table query");
      if (statement.startsWith("SELECT count(*)")) {
        const count = rows[table].filter((row) => row.normalization_version >= Number(values[0])).length;
        return { rows: [{ count: String(count) }], rowCount: 1 };
      }
      if (statement.startsWith("SELECT id, original_filename")) {
        const batchSize = Number(values[0]);
        const selected = rows[table].filter((row) => row.normalization_version === 0).sort((a, b) => a.id.localeCompare(b.id)).slice(0, batchSize);
        maximumSelected = Math.max(maximumSelected, selected.length);
        return { rows: selected.map((row) => ({ ...row, content: Buffer.from(row.content) })), rowCount: selected.length };
      }
      if (statement.startsWith("UPDATE")) {
        const [filename, mediaType, byteSize, sha256, content, version, id] = values as [string, string, number, string, Buffer, number, string];
        const row = rows[table].find((candidate) => candidate.id === id && candidate.normalization_version === 0);
        if (!row) return { rows: [], rowCount: 0 };
        Object.assign(row, {
          original_filename: filename,
          media_type: mediaType,
          byte_size: byteSize,
          sha256,
          content: Buffer.from(content),
          normalization_version: version,
        });
        return { rows: [], rowCount: 1 };
      }
      throw new Error("unexpected query");
    },
  };
  return { client, rows, get maximumSelected() { return maximumSelected; } };
}

async function legacyImage(format: "jpeg" | "png" | "webp", filename: string, marker: string) {
  let image = sharp({ create: { width: 3, height: 2, channels: 3, background: "#aabbcc" } });
  if (format === "jpeg") image = image.jpeg();
  if (format === "png") image = image.png();
  if (format === "webp") image = image.webp();
  const source = await image
    .withExif({ IFD0: { ImageDescription: marker, Make: "Fixture camera" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "12/1 34/1 56/1" } })
    .toBuffer();
  const mediaType = format === "jpeg" ? "image/jpeg" : `image/${format}`;
  return validateReceiptFile({ bytes: new Uint8Array(source), filename, mediaType });
}

function row(id: string, file: Awaited<ReturnType<typeof legacyImage>>, relationId: string, normalizationVersion = 0): Row {
  return {
    id,
    original_filename: file.originalFilename,
    media_type: file.mediaType,
    byte_size: file.byteSize,
    sha256: file.sha256,
    content: Buffer.from(file.content),
    normalization_version: normalizationVersion,
    created_at: "2024-02-03T04:05:06.000Z",
    relationship_id: relationId,
  };
}

describe("legacy evidence image backfill", () => {
  it("normalizes metadata-bearing JPEG, PNG, and WebP across all evidence tables and preserves identities", async () => {
    const marker = "BACKFILL_EXIF_GPS_MARKER_1427";
    const jpeg = await legacyImage("jpeg", "receipt.jpg", marker);
    const png = await legacyImage("png", "proof.png", marker);
    const webp = await legacyImage("webp", "settlement.webp", marker);
    const settlementWebp = await legacyImage("webp", "group-proof.webp", marker);
    const safe = await normalizeEvidenceImage(await legacyImage("webp", "already.webp", "CURRENT_ROW_MARKER"));
    const fixture = createClient({
      expense_receipts: [row("00000000-0000-0000-0000-000000000001", jpeg, "expense-id")],
      repayment_proofs: [row("00000000-0000-0000-0000-000000000002", png, "repayment-id")],
      group_expense_receipts: [row("00000000-0000-0000-0000-000000000003", webp, "group-expense-id")],
      group_settlement_proofs: [
        row("00000000-0000-0000-0000-000000000004", settlementWebp, "settlement-id"),
        row("00000000-0000-0000-0000-000000000005", safe, "already-current-settlement-id", EVIDENCE_IMAGE_NORMALIZATION_VERSION),
      ],
    });
    const { client, rows } = fixture;

    const first = await runEvidenceImageBackfill(client as never, 1);
    expect(fixture.maximumSelected).toBeLessThanOrEqual(1);
    expect(first).toEqual({
      expense_receipts: { converted: 1, alreadyCurrent: 0 },
      repayment_proofs: { converted: 1, alreadyCurrent: 0 },
      group_expense_receipts: { converted: 1, alreadyCurrent: 0 },
      group_settlement_proofs: { converted: 1, alreadyCurrent: 1 },
    });
    const expectedIdentity = new Map([
      ["00000000-0000-0000-0000-000000000001", "expense-id"],
      ["00000000-0000-0000-0000-000000000002", "repayment-id"],
      ["00000000-0000-0000-0000-000000000003", "group-expense-id"],
      ["00000000-0000-0000-0000-000000000004", "settlement-id"],
      ["00000000-0000-0000-0000-000000000005", "already-current-settlement-id"],
    ]);
    for (const table of tables) {
      for (const current of rows[table]) {
        expect(expectedIdentity.get(current.id)).toBe(current.relationship_id);
        expect(current.created_at).toBe("2024-02-03T04:05:06.000Z");
        expect(current.relationship_id).not.toBe("");
        if (current.normalization_version !== EVIDENCE_IMAGE_NORMALIZATION_VERSION) continue;
        expect(current.media_type).toBe("image/webp");
        expect(current.original_filename).toMatch(/\.webp$/u);
        expect(current.byte_size).toBe(current.content.byteLength);
        expect(current.sha256).toBe(sha256Hex(current.content));
        const metadata = await sharp(current.content).metadata();
        expect(metadata.exif).toBeUndefined();
        expect(Buffer.from(current.content).toString("latin1").includes(marker)).toBe(false);
      }
    }
    expect(rows.group_settlement_proofs[1]?.content.equals(safe.content)).toBe(true);

    const mapping = { id: "00000000-0000-4000-8000-000000000099", expenseReceiptId: rows.expense_receipts[0]!.id };
    const stored = rows.expense_receipts.find(({ id }) => id === mapping.expenseReceiptId)!;
    const query = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn().mockResolvedValue([{
        id: mapping.id,
        mediaType: stored.media_type,
        byteSize: stored.byte_size,
        content: stored.content,
      }]),
    };
    query.from.mockReturnValue(query);
    query.innerJoin.mockReturnValue(query);
    query.where.mockReturnValue(query);
    const sharedReceipt = await getSharedDebtorReceipt({ select: vi.fn(() => query) } as never, "00000000-0000-4000-8000-000000000088", mapping.id);
    expect(sharedReceipt).toMatchObject({ id: mapping.id, mediaType: "image/webp" });
    expect(sharedReceipt?.byteSize).toBe(sharedReceipt?.content.byteLength);
    expect(Buffer.from(sharedReceipt!.content).toString("latin1").includes(marker)).toBe(false);
    expect(mapping.expenseReceiptId).toBe(rows.expense_receipts[0]?.id);

    const second = await runEvidenceImageBackfill(client as never, 1);
    expect(second).toEqual({
      expense_receipts: { converted: 0, alreadyCurrent: 1 },
      repayment_proofs: { converted: 0, alreadyCurrent: 1 },
      group_expense_receipts: { converted: 0, alreadyCurrent: 1 },
      group_settlement_proofs: { converted: 0, alreadyCurrent: 2 },
    });
  });

  it("rolls back a malformed row's batch and resumes from committed batches", async () => {
    const valid = await legacyImage("jpeg", "one.jpg", "FIRST_MARKER");
    const malformed = validateReceiptFile({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]), filename: "broken.jpg", mediaType: "image/jpeg" });
    const { client, rows } = createClient({
      expense_receipts: [row("00000000-0000-0000-0000-000000000001", valid, "expense-a"), row("00000000-0000-0000-0000-000000000002", malformed, "expense-b")],
      repayment_proofs: [],
      group_expense_receipts: [],
      group_settlement_proofs: [],
    });
    await expect(runEvidenceImageBackfill(client as never, 1)).rejects.toMatchObject({
      table: "expense_receipts",
      rowId: "00000000-0000-0000-0000-000000000002",
    } satisfies Partial<EvidenceBackfillRowError>);
    expect(rows.expense_receipts[0]?.normalization_version).toBe(EVIDENCE_IMAGE_NORMALIZATION_VERSION);
    expect(rows.expense_receipts[1]?.normalization_version).toBe(0);
    expect(rows.expense_receipts[1]?.content.equals(malformed.content)).toBe(true);
    const original = rows.expense_receipts[1]?.content;
    if (!original) throw new Error("malformed fixture disappeared");
    const remediated = row("00000000-0000-0000-0000-000000000002", await legacyImage("jpeg", "remediated.jpg", "REMEDIATED"), "expense-b");
    rows.expense_receipts[1] = { ...remediated, created_at: "2024-02-03T04:05:06.000Z" };
    await expect(runEvidenceImageBackfill(client as never, 1)).resolves.toMatchObject({ expense_receipts: { converted: 1, alreadyCurrent: 1 } });
  });

  it("requires an explicitly named and confirmed database target", () => {
    expect(() => validateEvidenceBackfillEnvironment({ DB_NAME: "zplit_test" })).toThrow(/ZPLIT_EVIDENCE_BACKFILL_CONFIRM/u);
    expect(validateEvidenceBackfillEnvironment({ DB_NAME: "zplit_test", ZPLIT_EVIDENCE_BACKFILL_CONFIRM: "zplit_test:sanitize-evidence" })).toBe("zplit_test");
  });
});
