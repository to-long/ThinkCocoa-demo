/**
 * Trim a long string to "head…tail" so UUIDs, session ids, full user
 * agents etc. don't blow out their cell. Strings already short
 * enough are returned untouched.
 *
 * Defaults align with the audit-log detail screen: 4 leading + 4
 * trailing chars (per the Pencil design). Override per call site
 * if a different fingerprint length feels right (the audit list
 * table uses 6 / 3 to match its narrower column).
 */
export function truncateMiddle(s: string, head = 4, tail = 4): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
