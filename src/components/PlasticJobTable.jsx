function StatusPill({ status }) {
  const slug = (status || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return <span className={`pill pill-${slug}`}>{status}</span>;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

const usd = (n) => (n == null ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }));

export default function PlasticJobTable({ jobs, onEdit, deleteMode, selected, onToggle, allChecked, onToggleAll }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {deleteMode && (
              <th className="chk-col">
                <input type="checkbox" checked={allChecked} onChange={onToggleAll} aria-label="Select all" />
              </th>
            )}
            <th>Job Title</th>
            <th>Customer</th>
            <th className="num">Qty</th>
            <th>From</th>
            <th>Status</th>
            <th className="num">Cost</th>
            <th className="num">Profit</th>
            <th>PO Number</th>
            <th>Ship To</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => {
            const profit = j.cost == null && j.revenue == null ? null : (Number(j.revenue) || 0) - (Number(j.cost) || 0);
            return (
              <tr
                key={j.id}
                onClick={() => (deleteMode ? onToggle(j.id) : onEdit(j))}
                className={"row" + (deleteMode && selected.has(j.id) ? " selected" : "")}
              >
                {deleteMode && (
                  <td className="chk-col" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(j.id)} onChange={() => onToggle(j.id)} aria-label={`Select ${j.job_title}`} />
                  </td>
                )}
                <td className="cell-title">{j.job_title}</td>
                <td>{j.brand || "—"}</td>
                <td className="num">{(j.qty ?? 0).toLocaleString()} {j.qty_unit || ""}</td>
                <td>{j.origin || "—"}</td>
                <td><StatusPill status={j.status} /></td>
                <td className="num">{usd(j.cost)}</td>
                <td className="num">{usd(profit)}</td>
                <td>{j.po_number || "—"}</td>
                <td>{j.ship_to || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
