import { useCallback, useEffect } from 'react';
import { useDebouncedCallback } from 'use-debounce';

export function useKeyPressed(targetKey: string, callback: () => void) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === targetKey) {
        callback();
      }
    },
    [targetKey, callback],
  );

  const handleKeyDownDebounced = useDebouncedCallback(handleKeyDown, 200, { leading: true });

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDownDebounced);
    return () => {
      window.removeEventListener('keydown', handleKeyDownDebounced);
    };
  }, [handleKeyDownDebounced]);
}
