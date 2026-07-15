import { useState, useEffect } from "react";
import JobTable from "./JobTable";
import { fetchSttarkStatuses } from "../sttark/status";
import { mapSttarkStatus } from "../sttark/statusMap";
import { supabase } from "../supabaseClient";

export default function WorkOrders({
  jobs, customers, onNew, onEdit, onDeleteMany, onStatus, onFacility,
}) {
  const [query, setQuery] = useState("");
  const [deleteMode, setDeleteMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sttark, setSttark] = useState({});

  useEffect(() => {
    const linked = jobs.filter((j) => j.sttark_order_id);
    if (linked.length === 0) { setSttark({}); return; }
    let active = true;
    fetchSttarkStatuses(linked.map((j) => j.sttark_order_id)).then(async ({ statuses: s }) => {
      if (!active) return;
      setSttark(s);
      const updates = [];
      for (const j of linked) {
        // "Delivered" is a human-confirmed final state. Sttark only knows the
        // order shipped (it can't see customer receipt), so never auto-revert it.
        if (j.status === "Delivered") continue;
        const mapped = mapSttarkStatus(s[j.sttark_order_id]?.status_label);
        if (mapped && mapped !== j.status)
          updates.push(supabase.from("jobs").update({ status: mapped }).eq("id", j.id));
      }
      if (updates.length > 0) await Promise.allSettled(updates);
    });
    return () => { active = false; };
  }, [jobs]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? jobs.filter((j) =>
        [j.job_title, j.brand, j.po_number, j.sttark_order_id]
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
            <h1 className="page-title">Label work orders</h1>
            <span className="page-meta">{filtered.length} {filtered.length === 1 ? "order" : "orders"}</span>
          </div>
          <input className="search-input page-search" type="search"
            placeholder="Search job, customer, PO…"
            value={query} onChange={(e) => setQuery(e.target.value)} list="customers" />
          <datalist id="customers">
            {customers.map((c) => <option key={c} value={c} />)}
          </datalist>
          <div className="page-head-right">
            {deleteMode && <button className="btn-ghost" onClick={exitDeleteMode}>Cancel</button>}
            <button className="btn-ghost del-btn" disabled={deleteMode && count === 0} onClick={onDeleteClick}>
              {deleteMode ? (count ? `Delete (${count})` : "Select orders…") : "Delete"}
            </button>
            <button className="btn-accent" onClick={onNew}>+ New Job</button>
          </div>
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
          <p className="muted">No orders have a customer matching "{query}".</p>
        </div>
      ) : (
        <JobTable
          jobs={filtered}
          onEdit={onEdit}
          deleteMode={deleteMode}
          selected={selected}
          onToggle={toggle}
          allChecked={allChecked}
          onToggleAll={toggleAll}
          sttark={sttark}
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
