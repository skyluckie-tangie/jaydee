// Audio gain utilities - dB <-> linear, common in pro DAWs like Cubase

export function linearToDb(g: number): string {
  if (g <= 0.0001) return '-∞';
  const db = 20 * Math.log10(Math.max(0.0001, g));
  return (db >= 0 ? '+' : '') + db.toFixed(1) + 'dB';
}

export function dbToLinear(db: number): number {
  if (db <= -100) return 0;
  return Math.pow(10, db / 20);
}

export function clampGain(g: number): number {
  return Math.max(0, Math.min(2, g)); // allow +6dB headroom
}
