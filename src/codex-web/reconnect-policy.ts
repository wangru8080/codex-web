const reconnectDelaysMs = [250, 500, 1000, 2000, 5000] as const;

export function reconnectDelayMs(attempt: number): number {
  const index = Math.max(0, Math.min(Math.floor(attempt), reconnectDelaysMs.length - 1));
  return reconnectDelaysMs[index];
}
