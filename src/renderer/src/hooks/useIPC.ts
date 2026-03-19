import { useEffect, useRef } from 'react';

export function useIPC<T>(
  subscribe: (listener: (event: T) => void) => () => void,
  listener: (event: T) => void
): void {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    return subscribe((event) => {
      listenerRef.current(event);
    });
  }, [subscribe]);
}
