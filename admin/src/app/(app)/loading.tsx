export default function Loading() {
  return (
    <div className="card loading-state" role="status" aria-live="polite">
      <span className="loading-spinner" aria-hidden />
      <span>Loading admin dashboard…</span>
    </div>
  );
}
