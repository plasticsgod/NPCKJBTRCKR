import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { buildQuotePDF } from "../lib/quotePdf";
import { MARGINS, money, money2 } from "../lib/pricing";
import { displayName } from "../projects/userMap";
import { toast } from "./Toaster";

// History of every quote saved from the Plastics Estimator. Each row can be
// expanded to see its line items, re-exported to the same branded PDF, or
// deleted.
export default function PlasticQuotes() {
  const [quotes, setQuotes] = useState(null); // null = loading
  const [openId, setOpenId] = useState(null);
  const [query, setQuery] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [notesByQuote, setNotesByQuote] = useState({});
  const [noteDraft, setNoteDraft] = useState("");
  const [decide, setDecide] = useState(null); // { id, action: 'approved'|'rejected' }
  const [decisionNote, setDecisionNote] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email || ""));
  }, []);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("plastic_quotes").select("*").order("created_at", { ascending: false });
    setQuotes(data || []);
  }, []);

  const loadNotes = useCallback(async (id) => {
    const { data } = await supabase
      .from("quote_notes").select("*").eq("quote_id", id).order("created_at", { ascending: true });
    setNotesByQuote((prev) => ({ ...prev, [id]: data ?? [] }));
  }, []);

  function toggleOpen(id) {
    const next = openId === id ? null : id;
    setOpenId(next);
    setDecide(null); setDecisionNote(""); setNoteDraft("");
    if (next) loadNotes(next);
  }

  async function confirmDecision() {
    if (!decide) return;
    const { id, action } = decide;
    const { error } = await supabase.from("plastic_quotes").update({
      status: action,
      decision_note: decisionNote.trim() || null,
      decided_by: userEmail,
      decided_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) { toast.error("Couldn't update — " + error.message); return; }
    setDecide(null); setDecisionNote("");
    toast.success(action === "approved" ? "Quote approved" : "Quote rejected");
    load();
  }

  async function addMemberNote(id) {
    if (!noteDraft.trim()) return;
    const { error } = await supabase.from("quote_notes").insert({
      quote_id: id, author: userEmail, is_client: false, body: noteDraft.trim(),
    });
    if (error) { toast.error("Couldn't add note — " + error.message); return; }
    setNoteDraft("");
    loadNotes(id);
  }

  useEffect(() => {
    load();
    const ch = supabase.channel("plastic-quotes")
      .on("postgres_changes", { event: "*", schema: "public", table: "plastic_quotes" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [load]);

  async function remove(id) {
    if (!confirm("Delete this saved quote?")) return;
    const { error } = await supabase.from("plastic_quotes").delete().eq("id", id);
    if (error) { toast.error("Couldn't delete — " + error.message); return; }
    toast.success("Quote deleted");
  }

  function download(q) {
    buildQuotePDF({ customer: q.customer, lines: q.lines || [] });
  }

  // Create a plastics work order from a saved quote, carrying over what we know.
  // Cost is recoverable from each line: sell price = landed / margin-divisor, so
  // unit cost = unit charge × divisor. We snapshot the figures onto the order.
  async function sendToWorkOrders(q) {
    const lines = q.lines || [];
    const divisor = (lab) => MARGINS.find((m) => m.lab === lab)?.d ?? 0.5;
    const priced = lines.map((l) => {
      const d = divisor(l.marginLab);
      const unitCost = (Number(l.unit) || 0) * d;
      const units = Number(l.units) || 0;
      return {
        name: l.name,
        units,
        margin: l.marginLab,
        unit_charge: Number(l.unit) || 0,
        unit_cost: unitCost,
        total_charge: Number(l.total) || 0,
        total_cost: unitCost * units,
      };
    });
    const totalCost = priced.reduce((s, l) => s + l.total_cost, 0);
    const totalCharge = q.total || priced.reduce((s, l) => s + l.total_charge, 0);
    const qty = lines.reduce((s, l) => s + (Number(l.units) || 0), 0);
    const description = lines.map((l) => `${(l.units || 0).toLocaleString()} × ${l.name}`).join("\n");

    const { error } = await supabase.from("plastic_jobs").insert({
      job_title: `Quote #${q.quote_no}${q.customer ? " — " + q.customer : ""}`,
      brand: q.customer || null,
      description,
      qty,
      qty_unit: "tubs",
      cost: Math.round(totalCost * 100) / 100,
      revenue: Math.round(totalCharge * 100) / 100,
      status: "Submitted",
      created_by: q.created_by || null,
      pricing: { source: "quote", quote_no: q.quote_no, lines: priced, total_cost: totalCost, total_charge: totalCharge },
    });
    if (error) { toast.error("Couldn't send — " + error.message); return; }
    toast.success("Sent to Plastics Work Orders — cost & charge filled in");
  }

  if (quotes === null) return <div className="muted pad">Loading quotes…</div>;

  const q = query.trim().toLowerCase();
  const visible = q
    ? quotes.filter((row) =>
        (row.customer || "").toLowerCase().includes(q) ||
        ("#" + row.quote_no).includes(q))
    : quotes;

  return (
    <div className="quotes-page">
      <div className="page-card">
        <div className="page-head">
          <div className="page-head-left">
            <h1 className="page-title">Plastic quotes</h1>
            <span className="page-meta">{quotes.length} {quotes.length === 1 ? "quote" : "quotes"}</span>
          </div>
          {quotes.length > 0 && (
            <input className="search-input page-search" type="search" placeholder="Search customer or #…"
              value={query} onChange={(e) => setQuery(e.target.value)} />
          )}
        </div>

      {quotes.length === 0 ? (
        <div className="empty">
          <p className="muted">No saved quotes yet. Build one in the Plastics Estimator and hit “Save quote.”</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty"><p className="muted">No quotes match “{query}”.</p></div>
      ) : (
        <div className="quotes-list">
          {visible.map((row) => {
            const open = openId === row.id;
            const lines = row.lines || [];
            return (
              <div className={"quote-card" + (open ? " open" : "")} key={row.id}>
                <button className="quote-row" onClick={() => toggleOpen(row.id)}>
                  <span className="quote-no">#{row.quote_no}</span>
                  <span className="quote-customer">{row.customer || "—"}</span>
                  <span className="quote-meta">
                    {new Date(row.quote_date ? row.quote_date + "T00:00:00" : row.created_at).toLocaleDateString()} · {lines.length} line{lines.length === 1 ? "" : "s"}
                  </span>
                  {row.status && <span className={"q-badge q-" + row.status}>{row.status[0].toUpperCase() + row.status.slice(1)}</span>}
                  <span className="quote-total">{money2(row.total || 0)}</span>
                  <svg className="quote-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform var(--dur-fast) var(--ease)" }} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                </button>

                {open && (
                  <div className="quote-detail">
                    <table className="quote-lines">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Margin</th>
                          <th className="num">Units</th>
                          <th className="num">Unit</th>
                          <th className="num">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l, i) => (
                          <tr key={i}>
                            <td>{l.name}</td>
                            <td>{l.marginLab}</td>
                            <td className="num">{(l.units || 0).toLocaleString()}</td>
                            <td className="num">{money(l.unit, 3)}</td>
                            <td className="num">{money2(l.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="quote-detail-foot">
                      <span className="muted">Saved by {displayName(row.created_by) || "—"}</span>
                      <div className="quote-actions">
                        {row.status === "pending" && (
                          <>
                            <button className="btn-accent" onClick={() => { setDecide({ id: row.id, action: "approved" }); setDecisionNote(""); }}>Approve</button>
                            <button className="del-btn btn-ghost" onClick={() => { setDecide({ id: row.id, action: "rejected" }); setDecisionNote(""); }}>Reject</button>
                          </>
                        )}
                        <button className="btn-ghost" onClick={() => remove(row.id)}>Delete</button>
                        <button className="btn-ghost" onClick={() => sendToWorkOrders(row)}>Send to plastics work orders</button>
                        <button className="btn-accent" onClick={() => download(row)}>Download PDF</button>
                      </div>
                    </div>

                    {/* Approve/reject confirm with optional decision note */}
                    {decide && decide.id === row.id && (
                      <div className="quote-decide">
                        <label className="field">
                          <span>{decide.action === "approved" ? "Approve" : "Reject"} — add a note (optional, the client sees this)</span>
                          <textarea rows={2} value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)}
                            placeholder={decide.action === "approved" ? "e.g. Approved — we'll start production this week." : "e.g. Below our minimum order quantity."} />
                        </label>
                        <div className="quote-decide-actions">
                          <button className="btn-ghost" onClick={() => { setDecide(null); setDecisionNote(""); }}>Cancel</button>
                          <button className={decide.action === "approved" ? "btn-accent" : "btn-danger"} onClick={confirmDecision}>
                            {decide.action === "approved" ? "Confirm approval" : "Confirm rejection"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Decision outcome, once decided */}
                    {row.status && row.status !== "pending" && row.decision_note && (
                      <div className={"quote-decision q-" + row.status}>
                        <b>{row.status === "approved" ? "Approved" : "Rejected"}{row.decided_by ? " by " + (displayName(row.decided_by) || row.decided_by) : ""}:</b> {row.decision_note}
                      </div>
                    )}

                    {/* Notes thread (client + members) */}
                    <div className="quote-notes">
                      <div className="quote-notes-head">Notes</div>
                      {(notesByQuote[row.id] || []).length === 0 && !row.client_note ? (
                        <p className="muted small">No notes yet.</p>
                      ) : (
                        <div className="quote-notes-list">
                          {(notesByQuote[row.id] || []).map((n) => (
                            <div className={"quote-note" + (n.is_client ? " from-client" : "")} key={n.id}>
                              <span className="quote-note-who">{n.is_client ? (row.customer || "Client") : "NutraPack"}</span>
                              <span className="quote-note-body">{n.body}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="quote-note-add">
                        <input value={openId === row.id ? noteDraft : ""} placeholder="Add an internal note…"
                          onChange={(e) => setNoteDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMemberNote(row.id); } }} />
                        <button className="btn-ghost" onClick={() => addMemberNote(row.id)} disabled={!noteDraft.trim()}>Add note</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
