// A small, consistent loading indicator: spinner + label. Use for full-view
// loads that previously showed bare "Loading…" text.
export default function Loading({ label = "Loading", pad = true }) {
  return (
    <div className={"loading-row" + (pad ? " loading-pad" : "")}>
      <svg className="loading-spin" width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      <span>{label}…</span>
    </div>
  );
}
