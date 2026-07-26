import { Loader2 } from 'lucide-react';

/**
 * Suspense fallback for lazily-loaded route chunks. Fills its container
 * and centres a spinner — used both as the top-level router fallback and
 * inside the app shell's `<Outlet>` so the sidebar stays put while a
 * page chunk streams in.
 */
export function PageLoader() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
    </div>
  );
}
