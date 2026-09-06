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
  { scene: "records", step: 2, sectionId: "records", label: "History" },
  { scene: "finale", step: 0, sectionId: "finale", label: "Finish" },
];

export function clampPublicLandingIndex(index: number) {
  return Math.min(Math.max(index, 0), PUBLIC_LANDING_STATES.length - 1);
}

export function nextPublicLandingIndex(currentIndex: number, direction: -1 | 1) {
  return clampPublicLandingIndex(currentIndex + direction);
}

export function publicLandingStep(currentIndex: number, direction: -1 | 1) {
  const settledIndex = clampPublicLandingIndex(currentIndex);
  const nextIndex = nextPublicLandingIndex(settledIndex, direction);
  return {
    settledIndex,
    nextIndex,
    changed: nextIndex !== settledIndex,
  };
}

export function publicLandingTimelineRatio(index: number, stateCount = PUBLIC_LANDING_STATES.length) {
  const count = Math.max(stateCount, 1);
  return Math.min(Math.max(index, 0), count - 1) / Math.max(count - 1, 1);
}

export function nearestPublicLandingIndex(scrollY: number, snapPoints: readonly number[]) {
  if (snapPoints.length === 0) return 0;
  let nearest = 0;
  let distance = Math.abs(snapPoints[0]! - scrollY);
  snapPoints.forEach((point, index) => {
    const nextDistance = Math.abs(point - scrollY);
    if (nextDistance < distance) {
      distance = nextDistance;
      nearest = index;
    }
  });
  return nearest;
}

export function publicLandingAriaCurrent(active: boolean) {
  return active ? "step" : undefined;
}

export function firstPublicLandingIndexForSection(sectionId: string) {
  return PUBLIC_LANDING_STATES.findIndex((state) => state.sectionId === sectionId);
}
