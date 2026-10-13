import type { MouseEvent, ReactNode } from 'react';
import { navigate } from './router';

export function Link({ to, children, className }: { to: string; children: ReactNode; className?: string | undefined }) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={onClick} className={className}>
      {children}
    </a>
  );
}
