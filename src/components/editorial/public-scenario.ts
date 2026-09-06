export const ledgerStory = {
  outing: "Saturday market",
  date: "16 May 2026",
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
  groupExpense: { title: "Market + picnic", amount: 360_000 },
  groupBalance: { person: "Sari", amount: 90_000 },
  receipt: {
    merchant: "Market provisions",
    reference: "MKT-160526-014",
    time: "10:42",
    filename: "market-picnic.jpg",
    items: [
      { label: "Picnic meals · 3 × 70,000", amount: 210_000 },
      { label: "Fruit basket", amount: 60_000 },
      { label: "Drinks · 3 × 20,000", amount: 60_000 },
      { label: "Bread", amount: 30_000 },
    ],
  },
  searchRecords: [
    { id: "market", title: "Market + picnic", context: "Saturday market", date: "16 May 2026", amount: 360_000 },
    { id: "train", title: "Train home", context: "Saturday market", date: "16 May 2026", amount: 90_000 },
  ],
} as const;
