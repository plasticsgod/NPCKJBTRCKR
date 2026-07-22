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

export default function ClientOrders({ focusOrderId, onFocused }) {
  const [orders, setOrders] = useState(null);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("plastic_jobs")
      .select("id, brand, qty, qty_unit, revenue, pricing, approval, client_note, decision_note, decided_at, created_at")
      .order("created_at", { ascending: false });
    // Only rows that came through the approval flow (the client's submissions).
    setOrders((data ?? []).filter((o) => o.approval));
  }, []);

  useEffect(() => {
    load();
    const ch = supabase.channel("client-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "plastic_jobs" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [load]);

  useEffect(() => {
    if (focusOrderId) {
      setOpenId(focusOrderId);
      onFocused && onFocused();
    }
  }, [focusOrderId, onFocused]);

  const openOrder = useCallback((id) => {
    setOpenId((cur) => (cur === id ? null : id));
  }, []);

  if (orders === null) return <div className="muted pad">Loading your orders…</div>;

  return (
    <div className="quotes-page">
      <div className="page-card">
        <div className="page-head">
          <div className="page-head-left">
            <h1 className="page-title">My orders</h1>
            <span className="page-meta">{orders.length} {orders.length === 1 ? "order" : "orders"}</span>
          </div>
        </div>

        {orders.length === 0 ? (
          <div className="empty">
            <p className="empty-title">No orders yet</p>
            <p className="muted">Build one in the Estimator and hit “Send for approval.” It’ll show up here with its status.</p>
          </div>
        ) : (
          <div className="cq-list">
            {orders.map((o) => {
              const st = o.approval || "pending";
              const open = openId === o.id;
              const lines = (o.pricing && o.pricing.lines) || [];
              return (
                <div className={"cq-card" + (open ? " open" : "")} key={o.id}>
                  <button className="cq-row" onClick={() => openOrder(o.id)}>
                    <span className={"cq-status cq-" + st}>{STATUS_LABEL[st] || st}</span>
                    <span className="cq-main">
                      <span className="cq-total">{money(o.revenue)}</span>
                      <span className="cq-sub">{lines.length} item{lines.length === 1 ? "" : "s"} · sent {fmtDate(o.created_at)}</span>
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
                        {lines.map((l, i) => (
                          <div className="cq-line" key={i}>
                            <span>{l.name}</span>
                            <span className="cq-qty">{Number(l.units).toLocaleString()} units</span>
                            <span className="cq-amt">{money(l.total_charge)}</span>
                          </div>
                        ))}
                        <div className="cq-line cq-line-total">
                          <span>Total</span><span></span><span className="cq-amt">{money(o.revenue)}</span>
                        </div>
                      </div>

                      {st !== "pending" && o.decision_note && (
                        <div className={"cq-decision cq-" + st}>
                          <b>{st === "approved" ? "Approved" : "Rejected"}:</b> {o.decision_note}
                        </div>
                      )}

                      {o.client_note && (
                        <div className="quote-baked-note">
                          <span className="quote-baked-label">Note</span>
                          <span>{o.client_note}</span>
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
