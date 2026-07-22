import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { toast } from "./Toaster";
import PlasticJobTable from "./PlasticJobTable";

export default function PlasticWorkOrders({
  jobs, customers, onNew, onEdit, onDeleteMany,
}) {
  const [query, setQuery] = useState("");
  const [deleteMode, setDeleteMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [decide, setDecide] = useState(null);       // { id, action: 'approved'|'rejected' }
  const [decisionNote, setDecisionNote] = useState("");

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email || "")); }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? jobs.filter((j) =>
        [j.job_title, j.brand, j.po_number, j.origin]
          .some((v) => (v || "").toLowerCase().includes(q))
      )
    : jobs;

  // Pending approvals surface at the top; the board shows approved / normal
  // orders (rejected ones drop off the board but stay visible to the client).
  const pending = filtered.filter((j) => j.approval === "pending");
  const board = filtered.filter((j) => j.approval == null || j.approval === "approved");

  const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

  async function confirmDecision() {
    if (!decide) return;
    const { id, action } = decide;
    const order = jobs.find((j) => j.id === id);
    const patch = {
      approval: action,
      decision_note: decisionNote.trim() || null,
      decided_by: userEmail,
      decided_at: new Date().toISOString(),
    };
    if (action === "approved") patch.status = "Submitted"; // enters the production board
    const { error } = await supabase.from("plastic_jobs").update(patch).eq("id", id);
    if (error) { toast.error("Couldn't update — " + error.message); return; }
    // Notify the client who submitted it — in-app bell + email (best-effort).
    if (order?.created_by) {
      try {
        await supabase.from("notifications").insert({
          recipient: order.created_by, actor: userEmail,
          type: action === "approved" ? "order_approved" : "order_rejected",
          task: order.brand || null, body: decisionNote.trim() || null, link: id,
        });
      } catch { /* non-blocking */ }
      try {
        await supabase.functions.invoke("notify-quote-decision", {
          body: { email: order.created_by, status: action, customer: order.brand, note: decisionNote.trim() || null, total: order.revenue },
        });
      } catch { /* email best-effort */ }
    }
    setDecide(null); setDecisionNote("");
    toast.success(action === "approved" ? "Order approved — client emailed" : "Order rejected — client emailed");
  }


  function toggle(id) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected((s) => board.every((j) => s.has(j.id)) ? new Set() : new Set(board.map((j) => j.id)));
  }
  function exitDeleteMode() { setDeleteMode(false); setSelected(new Set()); }
  function onDeleteClick() {
    if (!deleteMode) { setDeleteMode(true); return; }
    if (selected.size > 0) setConfirmOpen(true);
  }
  function confirmDelete() { onDeleteMany([...selected]); setConfirmOpen(false); exitDeleteMode(); }

  const count = selected.size;
  const allChecked = board.length > 0 && board.every((j) => selected.has(j.id));

  return (
    <>
      <div className="page-card">
        <div className="page-head">
          <div className="page-head-left">
            <h1 className="page-title">Plastics work orders</h1>
            <span className="page-meta">{board.length} {board.length === 1 ? "order" : "orders"}</span>
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

      {pending.length > 0 && (
        <div className="wo-approvals">
          <div className="wo-approvals-head">Pending approval · {pending.length}</div>
          {pending.map((o) => (
            <div className="wo-approval" key={o.id}>
              <div className="wo-approval-main">
                <span className="wo-approval-title">{o.brand || o.job_title || "Order"}</span>
                <span className="wo-approval-sub">
                  {(o.qty || 0).toLocaleString()} {o.qty_unit || "units"} · {money(o.revenue)}
                  {o.created_by ? " · from " + o.created_by : ""}
                </span>
                {o.client_note && <span className="wo-approval-note">“{o.client_note}”</span>}
              </div>
              <div className="wo-approval-actions">
                <button className="btn-accent" onClick={() => { setDecide({ id: o.id, action: "approved" }); setDecisionNote(""); }}>Approve</button>
                <button className="del-btn btn-ghost" onClick={() => { setDecide({ id: o.id, action: "rejected" }); setDecisionNote(""); }}>Reject</button>
              </div>
              {decide && decide.id === o.id && (
                <div className="wo-decide">
                  <label className="field">
                    <span>{decide.action === "approved" ? "Approve" : "Reject"} — add a note (optional, the client sees this)</span>
                    <textarea rows={2} value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)}
                      placeholder={decide.action === "approved" ? "e.g. Approved — we'll start production this week." : "e.g. Below our minimum order quantity."} />
                  </label>
                  <div className="wo-decide-actions">
                    <button className="btn-ghost" onClick={() => { setDecide(null); setDecisionNote(""); }}>Cancel</button>
                    <button className={decide.action === "approved" ? "btn-accent" : "btn-danger"} onClick={confirmDecision}>
                      {decide.action === "approved" ? "Confirm approval" : "Confirm rejection"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No plastics orders yet</p>
          <p className="muted">Add your first order to get started.</p>
          <button className="btn-accent" onClick={onNew}>+ New Order</button>
        </div>
      ) : board.length === 0 && pending.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No matches</p>
          <p className="muted">No orders match "{query}".</p>
        </div>
      ) : board.length > 0 ? (
        <PlasticJobTable
          jobs={board}
          onEdit={onEdit}
          deleteMode={deleteMode}
          selected={selected}
          onToggle={toggle}
          allChecked={allChecked}
          onToggleAll={toggleAll}
        />
      ) : null}
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
