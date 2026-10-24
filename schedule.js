// Configured conservative cost window, UTC+8 display. Not a live pricing oracle.
export const MIN = 60000,
  HOUR = 60 * MIN,
  DAY = 24 * HOUR;
export const localDay = (at) =>
  new Date(at + 8 * HOUR).toISOString().slice(0, 10);
export function offPeak(at) {
  const d = new Date(at),
    day = d.getUTCDay(),
    h = d.getUTCHours();
  return day === 0 || day === 6 || !((h >= 1 && h < 4) || (h >= 6 && h < 10));
}
export function offPeakRemaining(at) {
  if (!offPeak(at)) return 0;
  const hour = new Date(at);
  hour.setUTCMinutes(0, 0, 0);
  for (let n = 1; n <= 72; n++) {
    const end = hour.getTime() + n * HOUR;
    if (!offPeak(end)) return end - at;
  }
  return 72 * HOUR;
}
