import { useEffect, useCallback } from 'react';

export function useGlobalSearchShortcut(onOpen: () => void) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const isModifier = e.metaKey || e.ctrlKey;
      if (isModifier && e.key.toLowerCase() === 'k') {
        // Global search should be reachable from anywhere, including the chat input.
        e.preventDefault();
        onOpen();
      }
    },
    [onOpen],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
