export type CameraCue = { progress: number; position: [number, number, number]; target: [number, number, number] };

export const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

const smoothstep = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

export function sampleCameraPath(cues: CameraCue[], progress: number) {
  if (cues.length === 0) throw new Error("A camera path needs at least one cue.");
  const p = clamp01(progress);
  const endIndex = cues.findIndex((cue) => cue.progress >= p);
  if (endIndex <= 0) return { position: [...cues[0].position], target: [...cues[0].target] };
  if (endIndex === -1) {
    const last = cues[cues.length - 1];
    return { position: [...last.position], target: [...last.target] };
  }
  const start = cues[endIndex - 1];
  const end = cues[endIndex];
  const t = smoothstep((p - start.progress) / Math.max(end.progress - start.progress, Number.EPSILON));
  const mix = (from: number, to: number) => from + (to - from) * t;
  return {
    position: start.position.map((value, index) => mix(value, end.position[index])) as [number, number, number],
    target: start.target.map((value, index) => mix(value, end.target[index])) as [number, number, number],
  };
}

export function damp(current: number, target: number, lambda: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * delta));
}
