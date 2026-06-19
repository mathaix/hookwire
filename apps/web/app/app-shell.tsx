import Link from "next/link";
import { navItems, type SectionKey } from "./data";

type AppShellProps = {
  active: SectionKey;
  eyebrow?: string;
  title: string;
  description: string;
  children: React.ReactNode;
};

export function AppShell({ active, eyebrow, title, description, children }: AppShellProps) {
  return (
    <div className="app-shell" data-testid="app-shell">
      <nav className="primary-nav" aria-label="Primary">
        <Link className="brand" href="/">
          <span className="brand-mark">HW</span>
          <span>Hookwire</span>
        </Link>
        <div className="nav-list">
          {navItems.map((item) => (
            <Link
              aria-current={item.key === active ? "page" : undefined}
              className="nav-link"
              href={item.href}
              key={item.key}
            >
              <span aria-hidden="true" className="nav-glyph">
                {item.glyph}
              </span>
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
      </nav>

      <main className="app-main">
        <header className="topbar" data-testid="topbar">
          <div className="switchers">
            <label className="switcher">
              <span>Organization</span>
              <select aria-label="Organization">
                <option>Acme Engineering</option>
              </select>
            </label>
            <label className="switcher">
              <span>Project</span>
              <select aria-label="Project">
                <option>hookwire/web</option>
              </select>
            </label>
          </div>
          <button className="user-menu" type="button" aria-label="User menu">
            <span className="avatar" aria-hidden="true">
              MW
            </span>
            <span>Maya</span>
          </button>
        </header>

        <section className="page-heading">
          {eyebrow ? <p>{eyebrow}</p> : null}
          <h1>{title}</h1>
          <span>{description}</span>
        </section>

        {children}
      </main>
    </div>
  );
}
