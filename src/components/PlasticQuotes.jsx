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
            <div className="page-head-right">
              <input className="search-input" type="search" placeholder="Search customer or #…"
                value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
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
                <button className="quote-row" onClick={() => setOpenId(open ? null : row.id)}>
                  <span className="quote-no">#{row.quote_no}</span>
                  <span className="quote-customer">{row.customer || "—"}</span>
                  <span className="quote-meta">
                    {new Date(row.quote_date ? row.quote_date + "T00:00:00" : row.created_at).toLocaleDateString()} · {lines.length} line{lines.length === 1 ? "" : "s"}
                  </span>
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
    </div>
  );
}
