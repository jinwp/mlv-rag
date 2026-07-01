/** Seconds → "MM:SS" or "H:MM:SS" (compact, for the big running timer). */
export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
}

/** Seconds → "HH:MM:SS" (full timestamp used on captures / transcript lines). */
export function fmtLog(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(ss)}`;
}

const WEEKDAYS = "일월화수목금토";

export function weekday(date: string): string {
  try {
    return WEEKDAYS[new Date(`${date}T00:00:00`).getDay()] ?? "";
  } catch {
    return "";
  }
}
