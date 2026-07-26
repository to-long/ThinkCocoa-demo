import * as React from 'react';

// Everything below this width is treated as "mobile" — the sidebar
// primitive swaps to a sheet/drawer, cards collapse to a single column,
// etc. Aligned with Tailwind's `lg` breakpoint so the whole app treats
// the 768-1024 band as tablet-leaning-mobile rather than a half-desktop
// layout. Bumping from 768 → 1024 ensures the left menu is always
// visible at true desktop widths and comes up as an overlay drawer
// below that, matching user expectations.
const MOBILE_BREAKPOINT = 1024;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener('change', onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return !!isMobile;
}
