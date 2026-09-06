export const ledgerStory = {
  outing: "Saturday market",
  date: "18 May 2026",
  expenses: [
    { id: "market", title: "Market + picnic", amount: 360_000 },
    { id: "train", title: "Train home", amount: 90_000 },
  ],
  personalShares: [
    { id: "raka", name: "Raka", amount: 120_000 },
    { id: "sari", name: "Sari", amount: 90_000 },
  ],
  repayment: { from: "Raka", amount: 120_000 },
  personalBalance: { friend: "Sari", amount: 90_000 },
  groupExpense: { title: "Market + picnic", amount: 480_000 },
  groupBalance: { person: "Sari", amount: 160_000 },
  searchRecords: [
    { id: "market", title: "Market + picnic", context: "Saturday market", date: "18 May 2026", amount: 360_000 },
    { id: "train", title: "Train home", context: "Saturday market", date: "18 May 2026", amount: 90_000 },
  ],
} as const;
