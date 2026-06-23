function StatusPill({ status }) {
  const slug = (status || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return <span className={`pill pill-${slug}`}>{status}</span>;
}

// Format an ISO timestamp as MM/DD/YYYY (numbers only).
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

export default function JobTable({ jobs, onEdit, selected, onToggle, allChecked, onToggleAll }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th className="chk-col">
              <input type="checkbox" checked={allChecked} onChange={onToggleAll} aria-label="Select all" />
            </th>
            <th>Job Title</th>
            <th>Customer</th>
            <th>Description</th>
            <th className="num">Print Qty</th>
            <th>Created</th>
            <th>Status</th>
            <th>Printing Facility</th>
            <th>PO Number</th>
            <th>Ship To</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} onClick={() => onEdit(j)} className={"row" + (selected.has(j.id) ? " selected" : "")}>
              <td className="chk-col" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected.has(j.id)}
                  onChange={() => onToggle(j.id)}
                  aria-label={`Select ${j.job_title}`}
                />
              </td>
              <td className="cell-title">{j.job_title}</td>
              <td>{j.brand || "—"}</td>
              <td className="cell-desc" title={j.description || ""}>{j.description || "—"}</td>
              <td className="num">{(j.print_qty ?? 0).toLocaleString()}</td>
              <td className="cell-date">{fmtDate(j.created_at)}</td>
              <td><StatusPill status={j.status} /></td>
              <td>{j.printing_facility || "—"}</td>
              <td>{j.po_number || "—"}</td>
              <td>{j.ship_to || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
