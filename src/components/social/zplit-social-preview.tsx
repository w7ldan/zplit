import type { ReactNode } from "react";

export const socialPreviewSize = { width: 1200, height: 630 } as const;

const rule = "1px solid #111315";

function LedgerRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "17px 0", borderTop: rule }}>
      <span style={{ color: "#62676B", fontSize: 22 }}>{label}</span>
      <span style={{ fontFamily: "monospace", fontSize: 27, fontWeight: 700, letterSpacing: 1 }}>{value}</span>
    </div>
  );
}

export function ZplitSocialPreview(): ReactNode {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "48px 56px", background: "#F4F1EA", color: "#111315" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 18, borderBottom: rule, fontSize: 20, fontWeight: 700, letterSpacing: 2 }}>
        <span>ZPLIT / SHARED EXPENSE LEDGER</span>
        <span style={{ color: "#62676B", fontSize: 16, letterSpacing: 1 }}>IDR / 2026</span>
      </div>

      <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 52 }}>
        <div style={{ width: 505, display: "flex", flexDirection: "column" }}>
          <div style={{ color: "#62676B", fontSize: 20, fontWeight: 700, letterSpacing: 2 }}>ZPLIT</div>
          <div style={{ marginTop: 18, fontSize: 60, fontWeight: 700, lineHeight: 1.05 }}>Shared expenses, clearly settled.</div>
          <div style={{ marginTop: 30, color: "#62676B", fontSize: 22 }}>Outings · Shares · Repayments · Balances</div>
        </div>

        <div style={{ flex: 1, padding: "24px 28px 20px", border: rule, borderRadius: 16, background: "#C7E4F6", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 22 }}>
            <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: 2 }}>ILLUSTRATIVE LEDGER</span>
            <span style={{ color: "#62676B", fontSize: 16, letterSpacing: 1 }}>01 / SAMPLE</span>
          </div>
          <div style={{ display: "flex", padding: "16px 0 20px", borderTop: rule, borderBottom: rule, fontSize: 29, fontWeight: 700 }}>Bandung day out</div>
          <LedgerRow label="Assigned" value="Rp 126.500" />
          <LedgerRow label="Paid back" value="Rp 84.000" />
          <LedgerRow label="Still open" value="Rp 42.500" />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 18, borderTop: rule, color: "#62676B", fontSize: 17, letterSpacing: 1 }}>
        <span>PRIVATE BY DEFAULT / PUBLIC PREVIEW</span>
        <span>ZPLIT / IDR</span>
      </div>
    </div>
  );
}
