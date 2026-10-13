import { lazy, Suspense, useState } from 'react';
import { Link } from './lib/Link';
import { usePathname } from './lib/router';
import { Home } from './pages/Home';
import { Pricing } from './pages/Pricing';
import { Dashboard } from './pages/Dashboard';
import { Contact } from './pages/Contact';
import { Quote } from './pages/Quote';

// Loaded on demand (dynamic import).
const About = lazy(() => import('./pages/About'));

const LINKS: Array<{ path: string; label: string }> = [
  { path: '/', label: 'Home' },
  { path: '/pricing', label: 'Pricing' },
  { path: '/quote', label: 'Quote' },
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/about', label: 'About' },
  { path: '/contact', label: 'Contact' },
];

function Page({ pathname }: { pathname: string }) {
  switch (pathname) {
    case '/':
      return <Home />;
    case '/pricing':
      return <Pricing />;
    case '/dashboard':
      return <Dashboard />;
    case '/quote':
      return <Quote />;
    case '/about':
      return (
        <Suspense fallback={<p className="loading">Loading…</p>}>
          <About />
        </Suspense>
      );
    case '/contact':
      return <Contact />;
    default:
      return (
        <section className="section narrow" data-testid="not-found">
          <h1>Page not found</h1>
          <p>
            Nothing lives at <code>{pathname}</code>. <Link to="/">Go home</Link>.
          </p>
        </section>
      );
  }
}

export function App() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="shell">
      <header className="header">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Lumen
        </Link>
        <button
          className="burger"
          aria-label="Toggle navigation"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          data-testid="burger"
        >
          <span />
          <span />
          <span />
        </button>
        <nav className={menuOpen ? 'nav open' : 'nav'} aria-label="Main" onClick={() => setMenuOpen(false)}>
          {LINKS.map((link) => (
            <Link key={link.path} to={link.path} className={pathname === link.path ? 'active' : undefined}>
              {link.label}
            </Link>
          ))}
        </nav>
      </header>
      <main key={pathname} className="page-enter">
        <Page pathname={pathname} />
      </main>
      <footer className="footer">
        <p>© 2026 Lumen Analytics</p>
      </footer>
    </div>
  );
}
