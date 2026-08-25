export type DefaultAvatarMotif = {
  variant: number;
  accent: number;
  split: number;
  offset: number;
  tilt: number;
};

function hashSeed(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getDefaultAvatarMotif(userId: string): DefaultAvatarMotif {
  const seed = hashSeed(userId);
  return {
    variant: seed % 4,
    accent: (seed >>> 8) % 4,
    split: 12 + ((seed >>> 16) % 40),
    offset: 8 + ((seed >>> 22) % 40),
    tilt: (seed >>> 27) % 2,
  };
}
