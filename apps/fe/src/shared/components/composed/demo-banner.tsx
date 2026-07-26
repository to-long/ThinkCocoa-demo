/**
 * Demo watermark strip — the thin amber line above the app header.
 *
 * Shared by the authenticated shell (`AppHeader`, where it sits inside
 * the sticky wrapper so it pins with the header) and the unauthenticated
 * `AuthLayout`, so the login screen carries the same disclaimer.
 */
export function DemoBanner() {
  return (
    <div
      role="note"
      className="border-amber-200 border-b bg-amber-100 px-4 py-px text-center font-medium text-[10px] text-amber-900 leading-tight dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
    >
      Demo Environment — Not for Production Use
    </div>
  );
}
