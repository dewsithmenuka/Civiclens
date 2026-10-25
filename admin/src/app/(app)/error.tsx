'use client';

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="card error-state" role="alert">
      <h1>We couldn’t load this admin page</h1>
      <p>The request may have timed out or the API may be unavailable. Your session and report data are unchanged.</p>
      <button className="btn btn-primary" onClick={() => reset()}>Try again</button>
    </section>
  );
}
