import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { buildQuotePDF } from "../lib/quotePdf";
import { money, money2 } from "../lib/pricing";
import { displayName } from "../projects/userMap";
import { toast } from "./Toaster";

// History of every quote saved from the Plastics Estimator. Each row can be
// expanded to see its line items, re-exported to the same branded PDF, or
// deleted.
export default function PlasticQuotes() {
  const [quotes, setQuotes] = useState(null); // null = loading
  const [openId, setOpenId] = useState(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("plastic_quotes").select("*").order("created_at", { ascending: false });
    setQuotes(data || []);
  }, []);

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
  // The user fills in PO, shipping, etc. on the work order afterward.
  async function sendToWorkOrders(q) {
    const lines = q.lines || [];
    const qty = lines.reduce((s, l) => s + (Number(l.units) || 0), 0);
    const description = lines.map((l) => `${(l.units || 0).toLocaleString()} × ${l.name}`).join("\n");
    const { error } = await supabase.from("plastic_jobs").insert({
      job_title: `Quote #${q.quote_no}${q.customer ? " — " + q.customer : ""}`,
      brand: q.customer || null,
      description,
      qty,
      qty_unit: "tubs",
      revenue: q.total || 0,
      status: "Submitted",
      created_by: q.created_by || null,
    });
    if (error) { toast.error("Couldn't send — " + error.message); return; }
    toast.success("Sent to Plastics Work Orders — open it there to add PO & shipping");
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
      <div className="quotes-head">
        <div>
          <h1 className="page-h1">Plastic Quotes</h1>
          <span className="quotes-sub">
            {quotes.length} saved quote{quotes.length === 1 ? "" : "s"}
          </span>
        </div>
        {quotes.length > 0 && (
          <input
            className="search-input"
            type="search"
            placeholder="Search by customer or #…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </div>

      {quotes.length === 0 ? (
        <div className="panel">
          <p className="muted">
            No saved quotes yet. Build one in the Plastics Estimator and hit “Save quote.”
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="panel"><p className="muted">No quotes match “{query}”.</p></div>
      ) : (
        <div className="quotes-list">
          {visible.map((row) => {
            const open = openId === row.id;
            const lines = row.lines || [];
            return (
              <div className={"quote-card" + (open ? " open" : "")} key={row.id}>
                <button className="quote-row" onClick={() => setOpenId(open ? null : row.id)}>
                  <span className="quote-no">#{row.quote_no}</span>
                  <span className="quote-customer">{row.customer || "—"}</span>
                  <span className="quote-meta">
                    {new Date(row.created_at).toLocaleDateString()} · {lines.length} line{lines.length === 1 ? "" : "s"}
                  </span>
                  <span className="quote-total">{money2(row.total || 0)}</span>
                  <span className="quote-caret">{open ? "▴" : "▾"}</span>
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
                        <button className="btn-ghost" onClick={() => remove(row.id)}>Delete</button>
                        <button className="btn-ghost" onClick={() => sendToWorkOrders(row)}>Send to plastics work orders</button>
                        <button className="btn-accent" onClick={() => download(row)}>Download PDF</button>
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
  );
}
