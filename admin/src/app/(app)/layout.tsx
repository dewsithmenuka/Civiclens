import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NavLink } from '@/components/NavLink';
import { SignOutButton } from '@/components/SignOutButton';
import { apiGet } from '@/lib/api';
import { STAFF_ROLES } from '@/lib/config';
import type { Me } from '@/lib/types';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await apiGet<Me>('/auth/me');
  if (!(STAFF_ROLES as readonly string[]).includes(me.role)) redirect('/login?error=forbidden');

  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/queue" className="brand"><span className="dot" aria-hidden /> CivicLens</Link>
          <nav className="nav" aria-label="Main">
            <NavLink href="/queue">Queue</NavLink>
            <NavLink href="/stats">Stats</NavLink>
            <NavLink href="/analytics">Analytics</NavLink>
            {me.role === 'ADMIN' && <NavLink href="/users">Users</NavLink>}
            {me.role === 'ADMIN' && <NavLink href="/audit">Audit log</NavLink>}
          </nav>
          <div className="user">
            <span>{me.displayName} · {me.role.toLowerCase()}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="container">{children}</main>
    </>
  );
}