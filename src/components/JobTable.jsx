function StatusPill({ status }) {
  const slug = (status || "").toLowerCase().replace(/\s+/g, "-");
  return <span className={`pill pill-${slug}`}>{status}</span>;
}

export default function JobTable({ jobs, onEdit, onDelete }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Job Title</th>
            <th>Brand</th>
            <th>Description</th>
            <th>Status</th>
            <th>Printing Facility</th>
            <th>PO Number</th>
            <th>Ship To</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} onClick={() => onEdit(j)} className="row">
              <td className="cell-title">{j.job_title}</td>
              <td>{j.brand || "—"}</td>
              <td className="cell-desc" title={j.description || ""}>
                {j.description || "—"}
              </td>
              <td>
                <StatusPill status={j.status} />
              </td>
              <td>{j.printing_facility || "—"}</td>
              <td>{j.po_number || "—"}</td>
              <td>{j.ship_to || "—"}</td>
              <td className="cell-actions">
                <button
                  className="link danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(j.id);
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
