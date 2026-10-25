import type { Metadata } from 'next';
import { safeNext } from '@/lib/safe-redirect';
import { LoginForm } from '@/components/LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

const MESSAGES: Record<string, string> = {
  session: 'Your session has ended. Please sign in again.',
  forbidden: 'Your account no longer has dashboard access.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="login-wrap">
      <div className="card login-card">
        <h1>CivicLens Admin</h1>
        <p className="muted">Moderators and administrators only.</p>
        <LoginForm next={safeNext(sp.next)} notice={sp.error ? MESSAGES[sp.error] : undefined} />
      </div>
    </main>
  );
}