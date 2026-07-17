import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";

const STATUS_LABEL = { pending: "Pending", approved: "Approved", rejected: "Rejected" };

function money(n) {
  return "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ClientQuotes() {
  const [quotes, setQuotes] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [notes, setNotes] = useState([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("plastic_quotes")
      .select("id, quote_no, quote_date, total, lines, status, client_note, decision_note, decided_at, created_at")
      .order("created_at", { ascending: false });
    setQuotes(data ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openQuote = useCallback(async (id) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    const { data } = await supabase
      .from("quote_notes").select("*").eq("quote_id", id).order("created_at", { ascending: true });
    setNotes(data ?? []);
  }, [openId]);

  if (quotes === null) return <div className="muted pad">Loading your quotes…</div>;

  return (
    <div className="quotes-page">
      <div className="page-card">
        <div className="page-head">
          <div className="page-head-left">
            <h1 className="page-title">My quotes</h1>
            <span className="page-meta">{quotes.length} {quotes.length === 1 ? "quote" : "quotes"}</span>
          </div>
        </div>

        {quotes.length === 0 ? (
          <div className="empty">
            <p className="empty-title">No quotes yet</p>
            <p className="muted">Build one in the Estimator and hit “Send for approval.” It’ll show up here with its status.</p>
          </div>
        ) : (
          <div className="cq-list">
            {quotes.map((q) => {
              const st = q.status || "pending";
              const open = openId === q.id;
              return (
                <div className={"cq-card" + (open ? " open" : "")} key={q.id}>
                  <button className="cq-row" onClick={() => openQuote(q.id)}>
                    <span className={"cq-status cq-" + st}>{STATUS_LABEL[st] || st}</span>
                    <span className="cq-main">
                      <span className="cq-total">{money(q.total)}</span>
                      <span className="cq-sub">{(q.lines || []).length} item{(q.lines || []).length === 1 ? "" : "s"} · sent {fmtDate(q.created_at)}</span>
                    </span>
                    <svg className="cq-caret" width="16" height="16" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform var(--dur-fast) var(--ease)" }}>
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>

                  {open && (
                    <div className="cq-detail">
                      <div className="cq-lines">
                        {(q.lines || []).map((l, i) => (
                          <div className="cq-line" key={i}>
                            <span>{l.name}</span>
                            <span className="cq-qty">{Number(l.units).toLocaleString()} units</span>
                            <span className="cq-amt">{money(l.total)}</span>
                          </div>
                        ))}
                        <div className="cq-line cq-line-total">
                          <span>Total</span><span></span><span className="cq-amt">{money(q.total)}</span>
                        </div>
                      </div>

                      {st !== "pending" && q.decision_note && (
                        <div className={"cq-decision cq-" + st}>
                          <b>{st === "approved" ? "Approved" : "Rejected"}:</b> {q.decision_note}
                        </div>
                      )}

                      <div className="cq-notes">
                        <div className="cq-notes-head">Notes</div>
                        {notes.length === 0 ? (
                          <p className="muted small">No notes on this quote.</p>
                        ) : (
                          notes.map((n) => (
                            <div className={"cq-note" + (n.is_client ? " mine" : "")} key={n.id}>
                              <span className="cq-note-who">{n.is_client ? "You" : "NutraPack"}</span>
                              <span className="cq-note-body">{n.body}</span>
                              <span className="cq-note-date">{fmtDate(n.created_at)}</span>
                            </div>
                          ))
                        )}
                        <p className="muted small cq-readonly">Notes are read-only once a quote is sent. Need a change? Build a new quote.</p>
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
