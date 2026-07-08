import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Parse a date string from the database as UTC.
 *
 * DB timestamps are stored as UTC but without timezone indicator
 * (e.g. "2026-02-26 07:23:45"). `new Date()` would misinterpret
 * these as local time. This helper normalises the string so the
 * browser always treats it as UTC.
 */
/**
 * Get today's date as YYYY-MM-DD in the host machine's local timezone.
 *
 * `new Date().toISOString().slice(0, 10)` returns UTC date, which can
 * differ from the user's local date (e.g. UTC+8 at local midnight is
 * still "yesterday" in UTC). This helper ensures date-based features
 * (daily check-in, memory files) align with the user's wall-clock date.
 */
export function getLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get the host machine's local timezone offset in minutes east of UTC.
 *
 * `Date.getTimezoneOffset()` returns UTC−local in minutes (e.g. UTC+8 → −480).
 * We negate it so callers get an intuitive "minutes east" value:
 *   UTC+8 → +480, UTC-5 → −300, UTC → 0.
 */
export function getLocalTzOffsetMinutes(): number {
  return -(new Date().getTimezoneOffset());
}

/**
 * Get the UTC datetime string for the start of a local calendar day.
 *
 * Used for SQL window boundaries: "give me all rows from local day X onwards".
 * Converts local midnight to its UTC equivalent.
 *
 * @param daysAgo - how many days before today (0 = today)
 * @returns UTC datetime string in "YYYY-MM-DD HH:mm:ss" format for SQLite
 */
export function localDayStartAsUTC(daysAgo: number = 0, now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0); // local midnight
  return d.toISOString().replace('T', ' ').split('.')[0];
}

export function parseDBDate(dateStr: string): Date {
  if (!dateStr) return new Date(0);
  // Already has timezone info (ISO with Z or offset) — parse as-is
  if (dateStr.includes('Z') || dateStr.includes('+') || /T\d{2}:\d{2}:\d{2}[+-]/.test(dateStr)) {
    return new Date(dateStr);
  }
  // DB format "YYYY-MM-DD HH:mm:ss" — append Z to mark as UTC
  return new Date(dateStr.replace(' ', 'T') + 'Z');
}
