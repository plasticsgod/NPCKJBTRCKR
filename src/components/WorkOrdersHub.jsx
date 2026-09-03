import WorkOrders from "./WorkOrders";
import PlasticWorkOrders from "./PlasticWorkOrders";

// Thin wrapper: one "Work Orders" nav entry with a Label / Plastics sub-toggle.
// It renders the two existing pages unchanged — same props, same data, same
// modals/flows — and only swaps which one is shown. `sub` ("label" | "plastic")
// and `onSub` come from App so the URL hash still drives it (existing links to
// #work_orders and #plastic_work_orders keep working).
export default function WorkOrdersHub({ sub, onSub, label, plastic }) {
  const isPlastic = sub === "plastic";
  return (
    <div className="wo-hub">
      <div className="wo-subtabs" role="tablist" aria-label="Work order type">
        <button
          type="button"
          role="tab"
          aria-selected={!isPlastic}
          className={"wo-subtab" + (!isPlastic ? " on" : "")}
          onClick={() => onSub("label")}
        >
          Label
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isPlastic}
          className={"wo-subtab" + (isPlastic ? " on" : "")}
          onClick={() => onSub("plastic")}
        >
          Plastics
        </button>
      </div>

      {isPlastic ? <PlasticWorkOrders {...plastic} /> : <WorkOrders {...label} />}
    </div>
  );
}
