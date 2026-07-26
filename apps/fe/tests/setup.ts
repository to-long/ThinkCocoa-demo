import '@testing-library/jest-dom';

// jsdom doesn't ship `ResizeObserver` (used by Radix Select / Dialog).
// Stub with a no-op so Radix mounts without throwing.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: typeof ResizeObserverStub }).ResizeObserver ??=
  ResizeObserverStub;

// jsdom also doesn't implement these scroll helpers Radix calls.
if (typeof Element !== 'undefined') {
  // biome-ignore lint/suspicious/noExplicitAny: jsdom prototype patch
  (Element.prototype as any).scrollIntoView ??= () => {};
  // biome-ignore lint/suspicious/noExplicitAny: jsdom prototype patch
  (Element.prototype as any).hasPointerCapture ??= () => false;
  // biome-ignore lint/suspicious/noExplicitAny: jsdom prototype patch
  (Element.prototype as any).releasePointerCapture ??= () => {};
}
