import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../supabaseClient";
import { toast } from "./Toaster";
import CustomerCombo from "./CustomerCombo";
import { MARGINS } from "../lib/pricing";
import { BUILTIN, computeQuote, money } from "../lib/quickQuote";
import { buildQuickQuotePDF } from "../lib/quickQuotePdf";
import { importInvoice } from "../lib/invoiceImport";

// Quick quote — informal, free-form quotes. Lines are either a custom item
// (typed, kept inside this quote only) or one of the built-ins:
//   Packaging (cost + margin, like the estimator) · Services (rate × hours)
//   Discount (% or $) · Shipping (manual amount)
// Cost and margin are internal; the PDF only ever shows sell prices.

let _uid = 0;
const uid = () => `l${Date.now().toString(36)}${(++_uid).toString(36)}`;
const blankLine = () => ({ id: uid(), item: "", desc: "", price: "", qty: "" });
const today = () => new Date().toISOString().slice(0, 10);
const EMPTY = () => ({ quote_number: null, customer: "", quote_date: today(), status: "draft", notes: "", lines: [blankLine(), blankLine()] });
const fmtDate = (iso) => { if (!iso) return "—"; const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${m}/${d}/${y}`; };
const SUB = { Packaging: "cost + margin", Services: "rate × hours", Discount: "% or $", Shipping: "enter amount" };

// ---------------------------------------------------------------------------
// Textarea that grows with its content.
function GrowText({ value, onChange, placeholder, className = "" }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = "auto"; el.style.height = el.scrollHeight + "px";
  }, [value]);
  return <textarea ref={ref} rows={1} className={"qq-grow " + className} value={value || ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

// ---------------------------------------------------------------------------
// Item picker: built-ins + items typed in this quote. Menu is portalled so the
// card's overflow can't clip it.
function ItemCombo({ value, onChange, localItems }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  const q = (value || "").trim().toLowerCase();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (inputRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return; setOpen(false); };
    const onScroll = (e) => { if (menuRef.current?.contains(e.target)) return; setOpen(false); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onScroll); };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    const H = 280, below = r.bottom + 6 + H < window.innerHeight;
    setPos({ left: r.left, width: Math.max(r.width, 230), top: below ? r.bottom + 6 : undefined, bottom: below ? undefined : window.innerHeight - r.top + 6 });
  }, [open, value]);

  const pick = (v) => { onChange(v); setOpen(false); };
  const types = ["Packaging", "Services"].filter((o) => o.toLowerCase().includes(q));
  const adj = ["Discount", "Shipping"].filter((o) => o.toLowerCase().includes(q));
  const mine = localItems.filter((o) => o.toLowerCase().includes(q) && o.toLowerCase() !== q);
  const exact = [...BUILTIN, ...localItems].some((o) => o.toLowerCase() === q);

  return (
    <div className="qq-combo">
      <input ref={inputRef} value={value || ""} placeholder="Select or type…"
        onFocus={() => setOpen(true)} onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Escape" || e.key === "Enter") setOpen(false); }} />
      <span className="qq-chev" aria-hidden="true">▾</span>
      {open && pos && createPortal(
        <div ref={menuRef} className="qq-dd" style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}>
          {types.length > 0 && <div className="qq-dd-cat">Line types</div>}
          {types.map((o) => <button type="button" key={o} className="qq-dd-item" onMouseDown={(e) => { e.preventDefault(); pick(o); }}>{o}<small>{SUB[o]}</small></button>)}
          {adj.length > 0 && <div className="qq-dd-cat">Adjustments</div>}
          {adj.map((o) => <button type="button" key={o} className="qq-dd-item" onMouseDown={(e) => { e.preventDefault(); pick(o); }}>{o}<small>{SUB[o]}</small></button>)}
          {mine.length > 0 && <div className="qq-dd-cat">This quote</div>}
          {mine.map((o) => <button type="button" key={o} className="qq-dd-item" onMouseDown={(e) => { e.preventDefault(); pick(o); }}>{o}</button>)}
          {q && !exact && <button type="button" className="qq-dd-item qq-dd-create" onMouseDown={(e) => { e.preventDefault(); pick(value.trim()); }}>+ Use “{value.trim()}”</button>}
        </div>,
        document.body
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import supplier invoice PDF -> packaging lines (review first).
function ImportModal({ onClose, onAdd }) {
  const [stage, setStage] = useState("pick"); // pick | reading | review | empty
  const [res, setRes] = useState(null);
  const [use, setUse] = useState([]);
  const [drag, setDrag] = useState(false);

  async function readFile(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { toast.error("Please choose a PDF."); return; }
    setStage("reading");
    try {
      const r = await importInvoice(file);
      if (!r.lines.length) { setStage("empty"); return; }
      setRes(r); setUse(r.lines.map(() => true)); setStage("review");
    } catch (e) {
      console.error("[invoice import]", e);
      setStage("empty");
    }
  }

  const chosen = res ? res.lines.filter((_, i) => use[i]) : [];
  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="modal qq-import" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Import from invoice</h2><button className="link" onClick={onClose}>Close</button></div>
        <div className="modal-body">
          {stage === "pick" && (
            <label className={"rfq-drop" + (drag ? " dragover" : "")}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDrag(false); }}
              onDrop={(e) => { e.preventDefault(); setDrag(false); readFile(e.dataTransfer.files?.[0]); }}>
              <input type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ""; }} />
              <span className="rfq-drop-main">Drag &amp; drop the supplier invoice PDF</span>
              <span className="field-hint">or</span>
              <span className="rfq-drop-btn">Select PDF</span>
              <span className="field-hint qq-drop-note">Lines come in as Packaging with the supplier's unit price as your cost. Supplier name, SKUs and PO numbers are left out.</span>
            </label>
          )}
          {stage === "reading" && <p className="qq-reading">Reading invoice…</p>}
          {stage === "empty" && (
            <div className="qq-reading">
              <p><b>No line items found.</b></p>
              <p className="muted small">This reads PDFs downloaded or emailed from the supplier. Photos and scans have no text inside, so they can't be read.</p>
              <button className="btn-ghost" onClick={() => setStage("pick")}>Try another file</button>
            </div>
          )}
          {stage === "review" && res && (
            <>
              <p className={"qq-check " + (res.matches ? "ok" : "warn")}>
                {res.matches
                  ? `✓ Found ${res.lines.length} line${res.lines.length === 1 ? "" : "s"} — matches the invoice total of ${money(res.balanceDue)}.`
                  : `Found ${res.lines.length} line${res.lines.length === 1 ? "" : "s"} adding up to ${money(res.sum)}${res.balanceDue != null ? `, but the invoice total is ${money(res.balanceDue)}` : ""}. Check nothing was missed.`}
              </p>
              <div className="qq-review">
                {res.lines.map((l, i) => (
                  <label key={i} className="qq-review-row">
                    <input type="checkbox" checked={!!use[i]} onChange={(e) => setUse((u) => u.map((x, j) => (j === i ? e.target.checked : x)))} />
                    <span className="qq-review-desc">{l.desc || "—"}</span>
                    <span className="qq-review-num">{l.qty.toLocaleString("en-US")} × {money(l.unitCost, 4)} cost</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={stage === "review" ? () => setStage("pick") : onClose}>{stage === "review" ? "Back" : "Cancel"}</button>
          {stage === "review" && (
            <button className="btn-accent" disabled={!chosen.length}
              onClick={() => onAdd(chosen.map((l) => ({ id: uid(), item: "Packaging", desc: l.desc, cost: String(l.unitCost), qty: String(l.qty), mIdx: 0, price: "" })))}>
              Add {chosen.length} line{chosen.length === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
export default function QuickQuote({ userEmail }) {
  const [view, setView] = useState("list");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  async function load() {
    const { data, error } = await supabase.from("quick_quotes").select("*").order("created_at", { ascending: false });
    if (error) { toast.error("Couldn't load quotes."); setLoading(false); return; }
    setRows(data || []); setLoading(false);
  }
  useEffect(() => {
    load();
    supabase.from("customers").select("name").order("name").then(({ data }) => setCustomers((data || []).map((c) => c.name).filter(Boolean)));
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setLine = (id, patch) => setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const removeLine = (id) => setForm((f) => { const lines = f.lines.filter((l) => l.id !== id); return { ...f, lines: lines.length ? lines : [blankLine()] }; });
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }));

  function newQuote() { setEditingId(null); setForm(EMPTY()); setView("builder"); }
  function openQuote(r) {
    const lines = (r.data?.lines || []).map((l) => ({ ...l, id: l.id || uid() }));
    setEditingId(r.id);
    setForm({ quote_number: r.quote_number, customer: r.customer || "", quote_date: r.quote_date || today(), status: r.status || "draft", notes: r.data?.notes || "", lines: lines.length ? lines : [blankLine()] });
    setView("builder");
  }

  const calc = computeQuote(form.lines);
  const localItems = [...new Set(form.lines.map((l) => (l.item || "").trim()).filter((v) => v && !BUILTIN.includes(v)))];

  async function save() {
    setSaving(true);
    const lines = form.lines.filter((l) => l.item || l.desc || l.price || l.cost || l.value);
    const payload = { customer: form.customer.trim() || null, quote_date: form.quote_date || null, status: form.status, data: { lines, notes: form.notes }, total: calc.total, created_by: userEmail };
    let error;
    if (editingId) {
      ({ error } = await supabase.from("quick_quotes").update(payload).eq("id", editingId));
    } else {
      const res = await supabase.from("quick_quotes").insert(payload).select("id, quote_number").single();
      error = res.error;
      if (!error && res.data) { setEditingId(res.data.id); set("quote_number", res.data.quote_number); }
    }
    setSaving(false);
    if (error) { toast.error("Couldn't save the quote."); return; }
    toast.success("Quote saved.");
    load();
  }

  async function doDelete(r) {
    setConfirmDel(null);
    const { error } = await supabase.from("quick_quotes").delete().eq("id", r.id);
    if (error) { toast.error("Couldn't delete the quote."); return; }
    toast.success("Quote deleted.");
    if (editingId === r.id) { setView("list"); setEditingId(null); }
    load();
  }

  const delModal = confirmDel && createPortal(
    <div className="overlay" onClick={() => setConfirmDel(null)}>
      <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Delete quote {confirmDel.quote_number || ""}?</h2></div>
        <div className="modal-body"><p>This can’t be undone.</p></div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
          <button className="btn-danger" onClick={() => doDelete(confirmDel)}>Delete quote</button>
        </div>
      </div>
    </div>,
    document.body
  );

  // ------------------------------------------------------------- list view
  if (view === "list") {
    return (
      <>
        <div className="page-card qq-page">
          <div className="page-head">
            <div className="page-head-left">
              <h1 className="page-title">Quick quotes</h1>
              <span className="page-meta">{rows.length} {rows.length === 1 ? "quote" : "quotes"}</span>
            </div>
            <div className="page-head-right"><button className="btn-accent" onClick={newQuote}>+ New quote</button></div>
          </div>
          {loading ? <p className="muted qq-pad">Loading…</p> : rows.length === 0 ? (
            <div className="empty">
              <p className="empty-title">No quick quotes yet</p>
              <p className="muted">Free-form quotes for anything — packaging, services, one-offs.</p>
              <button className="btn-accent" onClick={newQuote}>+ New quote</button>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Quote #</th><th>Customer</th><th className="qq-hide-sm">Date</th><th className="num">Total</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="row" onClick={() => openQuote(r)}>
                      <td className="cell-title">{r.quote_number || "—"}</td>
                      <td>{r.customer || "—"}</td>
                      <td className="qq-hide-sm">{fmtDate(r.quote_date)}</td>
                      <td className="num">{money(Number(r.total))}</td>
                      <td><span className={`pill ${r.status === "sent" ? "pill-rfq-issued" : "pill-rfq-draft"}`}>{r.status || "draft"}</span></td>
                      <td className="rfq-row-del" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="rfq-del-btn" onClick={() => setConfirmDel(r)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {delModal}
      </>
    );
  }

  // ---------------------------------------------------------- builder view
  const amountFor = (id) => calc.rows.find((r) => r.line.id === id);
  return (
    <>
      <div className="page-card qq-page">
        <div className="page-head">
          <div className="page-head-left">
            <h1 className="page-title">{form.quote_number ? `Quote ${form.quote_number}` : "New quick quote"}</h1>
            <span className="page-meta">Informal · free-form lines</span>
          </div>
          <div className="page-head-right qq-head-btns">
            <select className="rfq-status-sel" value={form.status} onChange={(e) => set("status", e.target.value)} aria-label="Quote status">
              <option value="draft">Draft</option><option value="sent">Sent</option>
            </select>
            {editingId && <button className="btn-ghost rfq-del-btn" onClick={() => setConfirmDel({ id: editingId, quote_number: form.quote_number })}>Delete</button>}
            <button className="btn-ghost" onClick={() => { setView("list"); load(); }}>Back</button>
            <button className="btn-ghost" onClick={() => buildQuickQuotePDF({ ...form })}>Export PDF</button>
            <button className="btn-accent" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save quote"}</button>
          </div>
        </div>

        <div className="qq-form">
          <div className="pm-section-label">Quote details</div>
          <div className="field-row">
            <label className="field"><span>Customer</span>
              <CustomerCombo value={form.customer} onChange={(v) => set("customer", v)} customers={customers} />
            </label>
            <label className="field"><span>Quote date</span>
              <input type="date" value={form.quote_date || ""} onChange={(e) => set("quote_date", e.target.value)} />
            </label>
          </div>

          <div className="pm-section-label qq-section-row">
            <span>Line items</span>
            <button type="button" className="qq-import-btn" onClick={() => setImportOpen(true)}>⤓ Import from invoice</button>
          </div>

          <div className="qq-lines-head"><span>Item</span><span>Description</span><span className="r">Price</span><span className="r">Qty / Hrs</span><span className="r">Amount</span><span /></div>
          <div className="qq-lines">
            {form.lines.map((l) => {
              const k = BUILTIN.includes(l.item) ? l.item.toLowerCase() : "item";
              const r = amountFor(l.id) || {};
              const amt = r.amount;
              const amtCell = <div className={"qq-amt" + (amt == null ? " none" : amt < 0 ? " neg" : "")}>{amt == null ? "—" : money(amt)}</div>;
              const x = <button type="button" className="qq-x" onClick={() => removeLine(l.id)} aria-label="Remove line">×</button>;
              const combo = (
                <div className="qq-c-item">
                  <ItemCombo value={l.item} localItems={localItems}
                    onChange={(v) => setLine(l.id, { item: v, ...(v === "Discount" && !l.mode ? { mode: "pct" } : {}), ...(v === "Packaging" && l.mIdx == null ? { mIdx: 0 } : {}) })} />
                  {(k === "packaging" || k === "services") && <span className="qq-kind">{k}</span>}
                </div>
              );
              return (
                <div key={l.id} className={"qq-line" + (k === "discount" || k === "shipping" ? " adj" : "")}>
                  {combo}
                  {k === "discount" ? (
                    <div className="qq-c-desc qq-adjbox">
                      <div className="qq-seg">
                        <button type="button" className={l.mode !== "flat" ? "on" : ""} onClick={() => setLine(l.id, { mode: "pct" })}>%</button>
                        <button type="button" className={l.mode === "flat" ? "on" : ""} onClick={() => setLine(l.id, { mode: "flat" })}>$ flat</button>
                      </div>
                      <span className="field-hint">{l.mode === "flat" ? "flat amount off" : "off the subtotal"}</span>
                    </div>
                  ) : (
                    <div className="qq-c-desc">
                      <GrowText value={l.desc} onChange={(v) => setLine(l.id, { desc: v })}
                        placeholder={k === "services" ? "e.g. Artwork setup, design revisions" : k === "packaging" ? "e.g. 8oz tub + lid, printed" : k === "shipping" ? "e.g. LTL freight to Houston" : "Description"} />
                    </div>
                  )}

                  {k === "discount" ? (
                    <div className={"qq-c-price " + (l.mode === "flat" ? "qq-money" : "qq-pct")}><input type="number" step="0.01" placeholder={l.mode === "flat" ? "0.00" : "0"} value={l.value || ""} onChange={(e) => setLine(l.id, { value: e.target.value })} /></div>
                  ) : k === "packaging" ? (
                    <div className="qq-c-price qq-money qq-computed"><input readOnly tabIndex={-1} placeholder="auto" value={r.unit == null ? "" : r.unit.toFixed(4)} title="Calculated from cost + margin" /></div>
                  ) : (
                    <div className="qq-c-price qq-money"><input type="number" step="0.01" placeholder={k === "services" ? "rate/hr" : "0.00"} value={l.price || ""} onChange={(e) => setLine(l.id, { price: e.target.value })} /></div>
                  )}

                  {k === "discount" || k === "shipping" ? <div className="qq-c-qty qq-na">—</div> : (
                    <div className={"qq-c-qty qq-unit"} data-suffix={k === "services" ? "hrs" : undefined}>
                      <input type="number" step={k === "services" ? "0.25" : "1"} placeholder={k === "services" ? "0" : "—"} value={l.qty || ""} onChange={(e) => setLine(l.id, { qty: e.target.value })} />
                    </div>
                  )}
                  {amtCell}
                  {x}

                  {k === "packaging" && (
                    <div className="qq-pk">
                      <span className="qq-pk-lab">Cost / unit</span>
                      <div className="qq-money qq-pk-cost"><input type="number" step="0.0001" placeholder="0.0000" value={l.cost || ""} onChange={(e) => setLine(l.id, { cost: e.target.value })} /></div>
                      <span className="qq-pk-lab">Margin</span>
                      <div className="qq-seg">
                        {MARGINS.map((m, i) => <button type="button" key={m.lab} className={l.mIdx === i ? "on" : ""} onClick={() => setLine(l.id, { mIdx: i })}>{m.lab}</button>)}
                        <button type="button" className={l.mIdx === "custom" ? "on" : ""} onClick={() => setLine(l.id, { mIdx: "custom" })}>Custom</button>
                      </div>
                      {l.mIdx === "custom" && <div className="qq-pct qq-pk-custom"><input type="number" step="0.1" min="0" max="99" placeholder="0" value={l.customM || ""} onChange={(e) => setLine(l.id, { customM: e.target.value })} /></div>}
                      <span className="qq-pk-sell">Sell <b>{r.unit == null ? "—" : money(r.unit, 4)}</b> / unit</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" className="btn-ghost qq-addline" onClick={addLine}>+ Add line</button>

          <div className="qq-totals">
            <div className="qq-trow"><span>Subtotal</span><span>{money(calc.sub)}</span></div>
            {calc.discount !== 0 && <div className="qq-trow neg"><span>Discount</span><span>{money(calc.discount)}</span></div>}
            {calc.shipping !== 0 && <div className="qq-trow"><span>Shipping</span><span>{money(calc.shipping)}</span></div>}
            <div className="qq-trow grand"><span>Total</span><span>{money(calc.total)}</span></div>
          </div>

          <div className="pm-section-label">Notes <span className="field-hint">— appears on the quote</span></div>
          <GrowText value={form.notes} onChange={(v) => set("notes", v)} className="qq-notes" placeholder="Terms, lead time, anything the customer should know…" />
        </div>
      </div>
      {delModal}
      {importOpen && (
        <ImportModal onClose={() => setImportOpen(false)}
          onAdd={(newLines) => {
            setForm((f) => ({ ...f, lines: [...f.lines.filter((l) => l.item || l.desc || l.price || l.cost), ...newLines] }));
            setImportOpen(false);
            toast.success(`Added ${newLines.length} line${newLines.length === 1 ? "" : "s"}. Pick a margin for each.`);
          }} />
      )}
    </>
  );
}
