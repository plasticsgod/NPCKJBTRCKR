import { useState } from "react";
import PlasticJobTable from "./PlasticJobTable";

export default function PlasticWorkOrders({
  jobs, customers, onNew, onEdit, onDeleteMany,
}) {
  const [query, setQuery] = useState("");
  const [deleteMode, setDeleteMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? jobs.filter((j) =>
        [j.job_title, j.brand, j.po_number, j.origin]
          .some((v) => (v || "").toLowerCase().includes(q))
      )
    : jobs;

  function toggle(id) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected((s) => filtered.every((j) => s.has(j.id)) ? new Set() : new Set(filtered.map((j) => j.id)));
  }
  function exitDeleteMode() { setDeleteMode(false); setSelected(new Set()); }
  function onDeleteClick() {
    if (!deleteMode) { setDeleteMode(true); return; }
    if (selected.size > 0) setConfirmOpen(true);
  }
  function confirmDelete() { onDeleteMany([...selected]); setConfirmOpen(false); exitDeleteMode(); }

  const count = selected.size;
  const allChecked = filtered.length > 0 && filtered.every((j) => selected.has(j.id));

  return (
    <>
      <div className="page-card">
        <div className="page-head">
          <div className="page-head-left">
            <h1 className="page-title">Plastics work orders</h1>
            <span className="page-meta">{filtered.length} {filtered.length === 1 ? "order" : "orders"}</span>
          </div>
          <input className="search-input page-search" type="search"
            placeholder="Search job, customer, origin…"
            value={query} onChange={(e) => setQuery(e.target.value)} list="plastic-customers" />
          <datalist id="plastic-customers">
            {customers.map((c) => <option key={c} value={c} />)}
          </datalist>
          <div className="page-head-right">
            {deleteMode && <button className="btn-ghost" onClick={exitDeleteMode}>Cancel</button>}
            <button className="btn-ghost del-btn" disabled={deleteMode && count === 0} onClick={onDeleteClick}>
              {deleteMode ? (count ? `Delete (${count})` : "Select orders…") : "Delete"}
            </button>
            <button className="btn-accent" onClick={onNew}>+ New Order</button>
          </div>
        </div>

      {jobs.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No plastics orders yet</p>
          <p className="muted">Add your first order to get started.</p>
          <button className="btn-accent" onClick={onNew}>+ New Order</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No matches</p>
          <p className="muted">No orders match "{query}".</p>
        </div>
      ) : (
        <PlasticJobTable
          jobs={filtered}
          onEdit={onEdit}
          deleteMode={deleteMode}
          selected={selected}
          onToggle={toggle}
          allChecked={allChecked}
          onToggleAll={toggleAll}
        />
      )}
      </div>

      {confirmOpen && (
        <div className="overlay">
          <div className="modal confirm-modal">
            <div className="modal-head">
              <h2>Delete {count > 1 ? `${count} orders` : "order"}?</h2>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete {count > 1 ? "these orders" : "this order"}? This cannot be undone.</p>
            </div>
            <div className="modal-foot">
              <button className="btn-ghost" onClick={() => setConfirmOpen(false)}>Cancel</button>
              <button className="btn-danger" onClick={confirmDelete}>
                Delete {count > 1 ? `${count} orders` : "order"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
