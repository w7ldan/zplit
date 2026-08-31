export type RegisteredFriendCandidate = {
  userId: string;
  displayName: string;
  username: string;
};

export type PersonalFriendCandidate = {
  personalFriendId: string;
  kind: "registered" | "local";
  userId: string | null;
  displayName: string;
  username: string | null;
  label: string | null;
};
