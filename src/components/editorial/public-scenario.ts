export const bandungStory = {
  outing: "Bandung day out",
  expenses: [{ description: "Dinner", amount: 240000 }, { description: "Taxi", amount: 120000 }],
  shares: [
    { expense: "Dinner", friend: "Rani", amount: 84000 },
    { expense: "Dinner", friend: "Dimas", amount: 42500 },
    { expense: "Taxi", friend: "Rani", amount: 42500 },
  ],
  repayment: { friend: "Rani", amount: 126500 },
  openBalance: { friend: "Dimas", amount: 42500 },
} as const;
