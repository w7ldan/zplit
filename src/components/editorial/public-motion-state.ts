export type PublicLandingState = {
  scene: "hero" | "record-flow" | "contexts" | "collaboration" | "proof" | "records" | "finale";
  step: number;
  sectionId: string;
  label: string;
};

export const PUBLIC_LANDING_STATES: readonly PublicLandingState[] = [
  { scene: "hero", step: 0, sectionId: "top", label: "Intro" },
  { scene: "record-flow", step: 0, sectionId: "record-flow", label: "Expense" },
  { scene: "record-flow", step: 1, sectionId: "record-flow", label: "Shares" },
  { scene: "record-flow", step: 2, sectionId: "record-flow", label: "Repayment" },
  { scene: "record-flow", step: 3, sectionId: "record-flow", label: "Balance" },
  { scene: "contexts", step: 0, sectionId: "contexts", label: "Personal" },
  { scene: "contexts", step: 1, sectionId: "contexts", label: "Groups" },
  { scene: "contexts", step: 2, sectionId: "contexts", label: "Organizations" },
  { scene: "collaboration", step: 0, sectionId: "collaboration", label: "Together" },
  { scene: "proof", step: 0, sectionId: "proof", label: "Proof" },
  { scene: "records", step: 0, sectionId: "records", label: "Owner" },
  { scene: "records", step: 1, sectionId: "records", label: "Share" },
  { scene: "finale", step: 0, sectionId: "finale", label: "Finish" },
];

export function clampPublicLandingIndex(index: number) {
  return Math.min(Math.max(index, 0), PUBLIC_LANDING_STATES.length - 1);
}

export function nextPublicLandingIndex(currentIndex: number, direction: -1 | 1) {
  return clampPublicLandingIndex(currentIndex + direction);
}

export function firstPublicLandingIndexForSection(sectionId: string) {
  return PUBLIC_LANDING_STATES.findIndex((state) => state.sectionId === sectionId);
}
