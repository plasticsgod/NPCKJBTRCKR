import { useState } from "react";
import JobTable from "./JobTable";
import JobBoard from "./JobBoard";

export default function WorkOrders({
  jobs, customers, onNew, onEdit, onDeleteMany, onStatus, onFacility,
}) {
  const [view, setView] = useState("table");
  const [query, setQuery] = useState("");
  const [deleteMode, setDeleteMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? jobs.filter((j) => (j.brand || "").toLowerCase().includes(q))
    : jobs;

  function toggle(id) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected((s) => {
      if (filtered.every((j) => s.has(j.id))) return new Set();
      return new Set(filtered.map((j) => j.id));
    });
  }
  function exitDeleteMode() {
    setDeleteMode(false);
    setSelected(new Set());
  }
  function onDeleteClick() {
    if (!deleteMode) { setDeleteMode(true); return; } // first click: reveal checkboxes
    if (selected.size > 0) setConfirmOpen(true);       // later clicks: confirm
  }
  function confirmDelete() {
    onDeleteMany([...selected]);
    setConfirmOpen(false);
    exitDeleteMode();
  }

  const count = selected.size;
  const allChecked = filtered.length > 0 && filtered.every((j) => selected.has(j.id));

  return (
    <>
      <div className="toolbar">
        <div className="toggle">
          <button className={view === "table" ? "toggle-on" : ""} onClick={() => setView("table")}>Table</button>
          <button className={view === "board" ? "toggle-on" : ""} onClick={() => setView("board")}>Board</button>
        </div>

        <input
          className="search-input"
          type="search"
          placeholder="Search by customer…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          list="customers"
        />
        <datalist id="customers">
          {customers.map((c) => <option key={c} value={c} />)}
        </datalist>

        <span className="count">{filtered.length} {filtered.length === 1 ? "order" : "orders"}</span>

        <button className="btn-accent push-right" onClick={onNew}>+ New Job</button>

        {view === "table" && (
          <>
            {deleteMode && (
              <button className="btn-ghost" onClick={exitDeleteMode}>Cancel</button>
            )}
            <button
              className="btn-ghost del-btn"
              disabled={deleteMode && count === 0}
              onClick={onDeleteClick}
            >
              {deleteMode
                ? (count ? `Delete (${count})` : "Select orders…")
                : "Delete"}
            </button>
          </>
        )}
      </div>

      {jobs.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No work orders yet</p>
          <p className="muted">Add your first job to get started.</p>
          <button className="btn-accent" onClick={onNew}>+ New Job</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No matches</p>
          <p className="muted">No orders have a customer matching “{query}”.</p>
        </div>
      ) : view === "table" ? (
        <JobTable
          jobs={filtered}
          onEdit={onEdit}
          deleteMode={deleteMode}
          selected={selected}
          onToggle={toggle}
          allChecked={allChecked}
          onToggleAll={toggleAll}
        />
      ) : (
        <JobBoard jobs={filtered} onEdit={onEdit} onStatus={onStatus} onFacility={onFacility} />
      )}

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
