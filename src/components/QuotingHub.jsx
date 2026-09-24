// Thin wrapper: one "Quoting" nav entry with a Quick quote / Estimator / RFQ
// sub-toggle. Renders the existing pages unchanged — only swaps which is shown.
// `sub` ("quick" | "estimator" | "rfq") and `onSub` come from App so the URL
// hash still drives it (#quick_quote, #plastics and #rfq all keep working).
const TABS = [
  { id: "quick", label: "Quick quote" },
  { id: "estimator", label: "Estimator" },
  { id: "rfq", label: "RFQ" },
];

export default function QuotingHub({ sub, onSub, quick, estimator, rfq }) {
  const view = { quick, estimator, rfq }[sub] || quick;
  return (
    <div className="wo-hub">
      <div className="wo-subtabs" role="tablist" aria-label="Quoting type">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={sub === t.id}
            className={"wo-subtab" + (sub === t.id ? " on" : "")} onClick={() => onSub(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {view}
    </div>
  );
}
