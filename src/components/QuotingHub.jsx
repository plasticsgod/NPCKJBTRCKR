// Thin wrapper: one "Quoting" nav entry with an Estimator / RFQ sub-toggle.
// Renders the two existing pages unchanged — only swaps which is shown. `sub`
// ("estimator" | "rfq") and `onSub` come from App so the URL hash still drives
// it (existing #plastics and #rfq links keep working).
export default function QuotingHub({ sub, onSub, estimator, rfq }) {
  const isRfq = sub === "rfq";
  return (
    <div className="wo-hub">
      <div className="wo-subtabs" role="tablist" aria-label="Quoting type">
        <button
          type="button"
          role="tab"
          aria-selected={!isRfq}
          className={"wo-subtab" + (!isRfq ? " on" : "")}
          onClick={() => onSub("estimator")}
        >
          Estimator
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isRfq}
          className={"wo-subtab" + (isRfq ? " on" : "")}
          onClick={() => onSub("rfq")}
        >
          RFQ
        </button>
      </div>

      {isRfq ? rfq : estimator}
    </div>
  );
}
