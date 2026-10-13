import { useEffect, useState } from 'react';

const listeners = new Set<() => void>();

export function navigate(path: string): void {
  if (path === window.location.pathname) return;
  window.history.pushState({}, '', path);
  window.scrollTo(0, 0);
  listeners.forEach((fn) => fn());
}

export function usePathname(): string {
  const [pathname, setPathname] = useState(window.location.pathname);
  useEffect(() => {
    const update = (): void => setPathname(window.location.pathname);
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return pathname;
}
