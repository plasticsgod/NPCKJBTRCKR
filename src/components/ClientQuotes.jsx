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

export default function ClientQuotes({ focusQuoteId, onFocused }) {
  const [quotes, setQuotes] = useState(null);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("plastic_quotes")
      .select("id, quote_no, quote_date, total, lines, status, client_note, decision_note, decided_at, created_at")
      .order("created_at", { ascending: false });
    setQuotes(data ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (focusQuoteId) {
      setOpenId(focusQuoteId);
      onFocused && onFocused();
    }
  }, [focusQuoteId, onFocused]);

  const openQuote = useCallback((id) => {
    setOpenId(openId === id ? null : id);
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

                      {q.client_note && (
                        <div className="quote-baked-note">
                          <span className="quote-baked-label">Note</span>
                          <span>{q.client_note}</span>
                        </div>
                      )}
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
