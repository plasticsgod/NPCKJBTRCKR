import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "../supabaseClient";
import {
  MARGINS, ORIGINS, PORTS,
  findItem, unitEconomics, setEconomics, unitsFromQty, money, money2,
} from "../lib/pricing";
import PricingEditor from "./PricingEditor";
import { buildQuotePDF, buildClientQuotePDF } from "../lib/quotePdf";
import { toast } from "./Toaster";

let _lineSeq = 0;
const nextLineId = () => ++_lineSeq;
const cap = (s) => s[0].toUpperCase() + s.slice(1);

export default function PlasticsEstimator({ userEmail, clientMode = false, onSubmitted }) {
  // "Client view" preview: internal users can flip the page into exactly what a
  // client sees (final prices only). Clients get this same component locked on.
  const [previewClient, setPreviewClient] = useState(false);
  const asClient = clientMode || previewClient;
  const [versions, setVersions] = useState([]);
  const [vi, setVi] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);

  // Shipping (internal only). Freight is typed manually — no auto-fill.
  const [ship, setShip] = useState({ origin: "", port: "", freight: 0, portc: 0, truck: 0, ware: 0 });

  // Store-style quote: each line = product + unit + qty + margin.
  const [lines, setLines] = useState([]);
  const [customer, setCustomer] = useState("");
  const [quoteDate, setQuoteDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Product search
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [plCat, setPlCat] = useState("all");
  const searchRef = useRef(null);

  const [customerRows, setCustomerRows] = useState([]);
  const [clientProducts, setClientProducts] = useState([]);
  const [myCustomer, setMyCustomer] = useState(null); // {id,name} for a signed-in client
  const [clientNote, setClientNote] = useState("");   // client's note when sending for approval

  // Final-price-only product list (a live DB view). This is ALL a client's
  // browser ever receives — no factory cost, tariff, or margin.
  const loadClientProducts = useCallback(async () => {
    const { data, error } = await supabase
      .from("client_products")
      .select("*")
      .order("sort_group")
      .order("pos");
    if (error) { console.error("client_products:", error.message); }
    else setClientProducts(data ?? []);
    if (clientMode) setLoading(false);
  }, [clientMode]);

  const loadCustomers = useCallback(async () => {
    const { data } = await supabase.from("customers").select("id,name").order("name");
    setCustomerRows(data ?? []);
  }, []);

  const loadVersions = useCallback(async () => {
    const { data, error } = await supabase
      .from("pricing_versions").select("*").order("created_at", { ascending: false });
    if (error) console.error("Load pricing failed:", error.message);
    else { setVersions(data ?? []); setVi(0); }
    setLoading(false);
  }, []);

  useEffect(() => { loadClientProducts(); if (!clientMode) loadCustomers(); }, [loadCustomers, loadClientProducts, clientMode]);

  // A signed-in client belongs to (at most) one customer — quotes are stamped
  // with it, which is also what the database rules require.
  useEffect(() => {
    if (!clientMode) return;
    supabase.from("client_users").select("customer_id, customers(name)").maybeSingle()
      .then(({ data }) => {
        if (data?.customer_id) setMyCustomer({ id: data.customer_id, name: data.customers?.name || "" });
      });
  }, [clientMode]);

  useEffect(() => {
    if (clientMode) return;              // clients never read the internal pricing table
    loadVersions();
    const ch = supabase.channel("pricing-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "pricing_versions" }, loadVersions)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [loadVersions, clientMode]);

  useEffect(() => {
    function onDown(e) { if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false); }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  if (loading) return <div className="muted pad">Loading pricing…</div>;
  if (!clientMode && versions.length === 0)
    return (
      <div className="empty">
        <p className="empty-title">No pricing yet</p>
        <p className="muted">Run the pricing setup SQL in Supabase to seed the first version.</p>
      </div>
    );

  const version = versions[vi];
  const data = version?.data ?? { tubs: [], lids: [], sets: {}, freight: {} }; // clients render from client_products, not this

  // Tariffs come straight from the version (edited via "Edit pricing").
  const ov = {};
  [...data.tubs, ...data.lids].forEach((i) => (ov[i.id] = i.tariff ?? 0));

  const updateShip = (k, v) => setShip((s) => ({ ...s, [k]: v }));

  // --- grouped search results -------------------------------------------------
  const q = search.trim().toLowerCase();
  const match = (arr) => arr.filter((x) => x.name.toLowerCase().includes(q));
  const matchClient = (kind) => clientProducts.filter(
    (p) => p.kind === kind && p.name.toLowerCase().includes(q));
  const resTubs = match(data.tubs);
  const resLids = match(data.lids);
  const resSets = match(data.tubs.filter((t) => findItem(data, data.sets?.[t.id]))); // paired tubs only
  const hasResults = resTubs.length || resLids.length || resSets.length;

  function addLine(prod, name) {
    setLines((ls) => [...ls, { id: nextLineId(), prod, name, mode: "units", qty: "", marginIdx: null }]);
    setSearch(""); setSearchOpen(false);
  }
  const updateLine = (id, patch) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id) => setLines((ls) => ls.filter((l) => l.id !== id));

  // Price one builder line. Returns display values + a "saved" shape for PDF/save.
  // In client mode the price comes straight from the final-price view — the
  // browser never has factory cost, tariff, or margin to compute with.
  function priceLineClient(l) {
    const p = clientProducts.find((x) => x.prod === l.prod);
    if (!p) return { unit: null, units: null, total: null, saved: null };
    const qn = parseFloat(l.qty) || 0;
    const units = l.mode === "units" ? qn
      : l.mode === "pallets" ? qn * (Number(p.ppp) || 0)
      : qn * (Number(p.pcs) || 0);
    const unit = Number(p.unit_price);
    const tot = units ? unit * units : null;
    const saved = units ? { name: l.name, units, unit, total: tot } : null;
    return { unit, units, total: tot, saved };
  }

  function priceLine(l) {
    const [kind, id] = l.prod.split(":");
    const item = kind === "set" ? data.tubs.find((t) => t.id === id) : findItem(data, id);
    if (!item) return { unit: null, units: null, total: null, saved: null };
    const econ = kind === "set" ? setEconomics(data, item, ship, ov) : unitEconomics(item, kind, ship, ov);
    if (!econ) return { unit: null, units: null, total: null, saved: null };
    const qn = parseFloat(l.qty) || 0;
    const units = unitsFromQty(item, l.mode, qn);
    const hasMargin = l.marginIdx != null;
    const unit = hasMargin ? econ.sells[l.marginIdx] : null;
    const total = unit != null && units ? unit * units : null;
    let saved = null;
    if (hasMargin && units) {
      const freightU = kind === "set" ? unitEconomics(item, "tub", ship, ov).addOn : econ.addOn;
      const dutyU = kind === "set" ? (ov[item.id] || 0) + (ov[econ.lid.id] || 0) : econ.tariff;
      saved = { name: l.name, units, unit, total, marginLab: MARGINS[l.marginIdx].lab, freightU, dutyU, dutyIncluded: kind === "lid" };
    }
    return { unit, units, total, saved };
  }

  const priced = lines.map((l) => ({ l, ...(asClient ? priceLineClient(l) : priceLine(l)) }));
  const savedLines = priced.map((p) => p.saved).filter(Boolean);
  const total = savedLines.reduce((a, s) => a + s.total, 0);
  const needMargin = asClient ? 0 : priced.filter((p) => p.l.marginIdx == null).length;

  // Per-unit prices for the catalog at the bottom (reflects current shipping).
  function productPrices(kind, item) {
    const econ = kind === "set" ? setEconomics(data, item, ship, ov) : unitEconomics(item, kind, ship, ov);
    if (!econ) return { landed: null, sells: [] };
    return { landed: econ.landed, sells: econ.sells };
  }

  // Catalog grouped by category. Add a new category here (e.g. "glass") and it
  // appears as a tab + section automatically.
  const clientCatalog = [
    { id: "tubs", label: "Tubs", items: clientProducts.filter((p) => p.kind === "tub") },
    { id: "lids", label: "Lids", items: clientProducts.filter((p) => p.kind === "lid") },
    { id: "sets", label: "Sets", items: clientProducts.filter((p) => p.kind === "set") },
  ];

  const catalog = [
    { id: "tubs", label: "Tubs", items: data.tubs.map((t) => ({ prod: "tub:" + t.id, name: t.name, item: t, kind: "tub" })) },
    { id: "lids", label: "Lids", items: data.lids.map((l) => ({ prod: "lid:" + l.id, name: l.name, item: l, kind: "lid" })) },
    { id: "sets", label: "Sets", items: data.tubs.filter((t) => findItem(data, data.sets?.[t.id])).map((t) => ({ prod: "set:" + t.id, name: t.name.replace("Tub", "Set") + " + lid", item: t, kind: "set" })) },
  ];

  // Reuse the matching customer record, or create it — so every quote links to
  // a real customer and the directory fills itself as you work.
  async function resolveCustomerId(name) {
    const n = (name || "").trim();
    if (!n) return null;
    const hit = customerRows.find((c) => c.name.toLowerCase() === n.toLowerCase());
    if (hit) return hit.id;
    const { data, error } = await supabase.from("customers").insert({ name: n }).select("id").single();
    if (error) { console.error("Could not create customer:", error.message); return null; }
    loadCustomers();
    return data.id;
  }

  // Build a plastic_jobs (work order) row from the current estimate. Cost is
  // recoverable per line: unit cost = unit charge × margin divisor.
  function buildOrder({ id, customerName, customerId }) {
    const divisor = (lab) => MARGINS.find((m) => m.lab === lab)?.d ?? 0.5;
    const priced = savedLines.map((l) => {
      const d = divisor(l.marginLab);
      const unitCost = (Number(l.unit) || 0) * d;
      const units = Number(l.units) || 0;
      return {
        name: l.name, units, margin: l.marginLab,
        unit_charge: Number(l.unit) || 0, unit_cost: unitCost,
        total_charge: Number(l.total) || 0, total_cost: unitCost * units,
      };
    });
    const totalCost = priced.reduce((s, l) => s + l.total_cost, 0);
    const totalCharge = total || priced.reduce((s, l) => s + l.total_charge, 0);
    const qty = savedLines.reduce((s, l) => s + (Number(l.units) || 0), 0);
    const description = savedLines.map((l) => `${(l.units || 0).toLocaleString()} × ${l.name}`).join("\n");
    return {
      id,
      job_title: `Order${customerName ? " — " + customerName : ""}`,
      brand: customerName || null,
      description, qty, qty_unit: "tubs",
      cost: Math.round(totalCost * 100) / 100,
      revenue: Math.round(totalCharge * 100) / 100,
      status: null,                 // enters production only once approved
      approval: "pending",
      client_note: clientNote.trim() || null,
      created_by: userEmail,
      customer_id: customerId ?? null,
      pricing: { source: "estimator", lines: priced, total_cost: totalCost, total_charge: totalCharge },
    };
  }

  async function saveQuote() {
    if (savedLines.length === 0) {
      toast.error(asClient ? "Add a product and quantity first." : "Add at least one line with a margin first.");
      return;
    }
    try {
      const id = crypto.randomUUID();
      const customerName = clientMode ? (myCustomer?.name || userEmail) : (customer.trim() || null);
      const customerId = clientMode ? (myCustomer?.id ?? null) : await resolveCustomerId(customer);
      const { error } = await supabase.from("plastic_jobs").insert(buildOrder({ id, customerName, customerId }));
      if (error) { toast.error("Couldn't send order — " + error.message); return; }
      // Notify the members who review orders (best-effort).
      const REVIEWERS = ["taylor.knox@nutrapack.co", "jeff.weisser@nutrapack.co", "eduardonutramedia@gmail.com"];
      try {
        await supabase.from("notifications").insert(REVIEWERS.map((m) => ({
          recipient: m, actor: userEmail, type: "order_submitted",
          task: customerName, body: clientNote.trim() || null, link: id,
        })));
      } catch { /* non-blocking */ }
      setClientNote("");
      toast.success(clientMode ? "Sent for approval — we'll review it shortly." : "Work order created — pending approval.");
      onSubmitted && onSubmitted();
    } catch (e) {
      toast.error("Something went wrong sending the order.");
      console.error("[create-order]", e);
    }
  }
  function exportPdf() {
    if (savedLines.length === 0) {
      toast.error(asClient ? "Add a product and quantity first." : "Add at least one line with a margin first.");
      return;
    }
    const q = { customer: customer.trim() || null, quote_date: quoteDate, lines: savedLines, note: clientNote.trim() || null };
    if (asClient) buildClientQuotePDF(q); else buildQuotePDF(q);
  }

  return (
    <div className="estv2">
      <div className="estv2-head">
        <div className="estv2-title">
          <h1 className="page-h1">{asClient ? "Get a quote" : "Plastics Estimator"}</h1>
          {!asClient && versions.length > 1 && (
            <select className="ver-select" value={vi} onChange={(e) => setVi(+e.target.value)}>
              {versions.map((v, i) => (
                <option key={v.id} value={i}>{v.version_date} — {v.label}{i === 0 ? " (current)" : ""}</option>
              ))}
            </select>
          )}
        </div>
        {!clientMode && (
          <div className="estv2-actions">
            <button className={"btn-ghost" + (previewClient ? " on" : "")}
              onClick={() => setPreviewClient((v) => !v)}>
              {previewClient ? "Exit client view" : "Client view"}
            </button>
            {!previewClient && <button className="btn-ghost" onClick={() => setEditorOpen(true)}>Edit pricing</button>}
          </div>
        )}
      </div>

      {previewClient && !clientMode && (
        <div className="client-preview-banner">
          Viewing as a client — these are the prices a customer sees. Margins, costs, and shipping are hidden.
        </div>
      )}

      {asClient && (
        <div className="client-ship-note">
          <b>Prices exclude shipping.</b> Contact us for freight pricing.
        </div>
      )}

      {/* Shipping strip — internal only; freight typed manually */}
      {!asClient && (
      <div className="ship-strip">
        <span className="ship-strip-label">Shipping · internal only (sets freight per unit)</span>
        <div className="ship-strip-row">
          <label className="ss-fld"><span>Origin</span>
            <select value={ship.origin} onChange={(e) => updateShip("origin", e.target.value)}>
              <option value="">—</option>
              {ORIGINS.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <label className="ss-fld"><span>Port</span>
            <select value={ship.port} onChange={(e) => updateShip("port", e.target.value)}>
              <option value="">—</option>
              {PORTS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="ss-fld"><span>Container freight</span>
            <input type="number" min="0" value={ship.freight}
              onChange={(e) => updateShip("freight", parseFloat(e.target.value) || 0)} />
          </label>
          <label className="ss-fld"><span>Port / customs</span>
            <input type="number" min="0" value={ship.portc}
              onChange={(e) => updateShip("portc", parseFloat(e.target.value) || 0)} />
          </label>
          <label className="ss-fld"><span>Trucking</span>
            <input type="number" min="0" value={ship.truck}
              onChange={(e) => updateShip("truck", parseFloat(e.target.value) || 0)} />
          </label>
        </div>
      </div>
      )}

      {/* Product search */}
      <div className="prod-search" ref={searchRef}>
        <div className="prod-search-box">
          <span className="ps-icon" aria-hidden="true">⌕</span>
          <input value={search} placeholder="Add a product…"
            onFocus={() => setSearchOpen(true)}
            onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }} />
        </div>
        {searchOpen && asClient && (
          <div className="search-dd">
            {clientProducts.filter((p) => p.name.toLowerCase().includes(q)).length === 0 && (
              <div className="search-dd-empty">No products match “{search}”.</div>
            )}
            {["tub", "lid", "set"].map((k) => {
              const rows = matchClient(k);
              if (!rows.length) return null;
              const label = k === "tub" ? "Tubs" : k === "lid" ? "Lids" : "Sets (tub + lid)";
              return (
                <div key={k}>
                  <div className="search-dd-cat">{label}</div>
                  {rows.map((p) => (
                    <button key={p.prod} className="search-dd-item" onClick={() => addLine(p.prod, p.name)}>
                      {p.name}<span>+ add</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        {searchOpen && !asClient && (
          <div className="search-dd">
            {!hasResults && <div className="search-dd-empty">No products match “{search}”.</div>}
            {resTubs.length > 0 && <div className="search-dd-cat">Tubs</div>}
            {resTubs.map((t) => (
              <button key={"tub:" + t.id} className="search-dd-item" onClick={() => addLine("tub:" + t.id, t.name)}>
                {t.name}<span>+ add</span>
              </button>
            ))}
            {resLids.length > 0 && <div className="search-dd-cat">Lids</div>}
            {resLids.map((l) => (
              <button key={"lid:" + l.id} className="search-dd-item" onClick={() => addLine("lid:" + l.id, l.name)}>
                {l.name}<span>+ add</span>
              </button>
            ))}
            {resSets.length > 0 && <div className="search-dd-cat">Sets (tub + lid)</div>}
            {resSets.map((t) => (
              <button key={"set:" + t.id} className="search-dd-item"
                onClick={() => addLine("set:" + t.id, t.name.replace("Tub", "Set"))}>
                {t.name.replace("Tub", "Set")} + lid<span>+ add</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Quote lines */}
      {lines.length === 0 ? (
        <div className="quote-empty">Search for a product above to start your quote.</div>
      ) : (
        <>
          <div className="quote-meta-row">
            {clientMode ? (
              <label className="ss-fld qm-customer"><span>Company</span>
                <input type="text" value={myCustomer?.name || "Not linked yet"} readOnly />
              </label>
            ) : (
            <label className="ss-fld qm-customer"><span>Customer / project</span>
              <input type="text" list="quote-customer-list" placeholder="Type or pick a customer" value={customer}
                onChange={(e) => setCustomer(e.target.value)} />
              <datalist id="quote-customer-list">
                {customerRows.map((c) => <option key={c.id} value={c.name} />)}
              </datalist>
            </label>
            )}
            <label className="ss-fld"><span>Quote date</span>
              <input type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} />
            </label>
          </div>
          <div className="quote-lines">
          {priced.map(({ l, unit, units, total }) => (
            <div className="qline" key={l.id}>
              <div className="qline-top">
                <span className="qline-name">{l.name}</span>
                <div className="qline-right">
                  <span className={"qline-total" + (total == null ? " none" : "")}>{total == null ? "—" : money2(total)}</span>
                  <button className="qline-rm" onClick={() => removeLine(l.id)} aria-label={`Remove ${l.name}`}>×</button>
                </div>
              </div>
              <div className="qline-ctrls">
                <div className="seg">
                  {["units", "pallets", "containers"].map((m) => (
                    <button type="button" key={m} className={l.mode === m ? "on" : ""}
                      onClick={() => updateLine(l.id, { mode: m })}>{cap(m)}</button>
                  ))}
                </div>
                <input className="qline-qty" type="number" min="0" placeholder="Qty" value={l.qty}
                  onChange={(e) => updateLine(l.id, { qty: e.target.value })} />
                {!asClient && (
                  <select className={"qline-margin" + (l.marginIdx == null ? " empty" : "")}
                    value={l.marginIdx ?? ""}
                    onChange={(e) => updateLine(l.id, { marginIdx: e.target.value === "" ? null : +e.target.value })}>
                    <option value="">Pick margin</option>
                    {MARGINS.map((m, i) => <option key={i} value={i}>{m.lab}</option>)}
                  </select>
                )}
                {units != null && unit != null && l.mode !== "units" && (
                  <span className="qline-units">{units.toLocaleString()} units</span>
                )}
              </div>
            </div>
          ))}
          </div>
        </>
      )}

      {lines.length > 0 && (
        <>
          <div className="quote-total-bar">
            <span className="qtb-label">
              Total{needMargin ? <span className="qtb-note"> · {needMargin} line{needMargin > 1 ? "s" : ""} need a margin</span> : ""}
            </span>
            <span className="qtb-total">{money2(total)}</span>
          </div>
          <label className="client-note-field">
            <span>Add a note (optional — becomes part of the quote)</span>
            <textarea rows={2} value={clientNote} onChange={(e) => setClientNote(e.target.value)}
              placeholder="e.g. Specific PMS color, matte finish, delivery timing…" />
          </label>
          <div className="quote-actions">
            {clientMode
              ? <button className="btn-accent" onClick={saveQuote}>Send for approval</button>
              : <button className="btn-accent" onClick={saveQuote}>Send to work orders</button>}
            <button className={clientMode ? "btn-ghost" : "btn-accent"} onClick={exportPdf}>Export PDF</button>
          </div>
        </>
      )}

      {editorOpen && (
        <PricingEditor baseData={data} ship={ship} userEmail={userEmail}
          onClose={() => setEditorOpen(false)}
          onPublished={() => { setEditorOpen(false); loadVersions(); }} />
      )}

      {/* Full catalog / price list — reflects the shipping inputs above */}
      <div className="price-list-section">
        <div className="pl-head-row">
          <h2 className="pl-title">All products · per-unit</h2>
          <span className="pl-hint">Prices reflect the shipping inputs above</span>
        </div>

        <div className="pl-tabs">
          <button type="button" className={"pl-tab" + (plCat === "all" ? " on" : "")} onClick={() => setPlCat("all")}>All</button>
          {catalog.map((c) => (
            <button key={c.id} type="button" className={"pl-tab" + (plCat === c.id ? " on" : "")} onClick={() => setPlCat(c.id)}>{c.label}</button>
          ))}
        </div>

        <div className="pl-wrap">
          <div className="pl-table">
            <div className="pl-head">
              <span className="pl-name">Product</span>
              <span className="pl-num">{asClient ? "Price / unit" : "Landed"}</span><span></span>
            </div>
            {(asClient ? clientCatalog : catalog).filter((c) => plCat === "all" || plCat === c.id).map((c) => (
              <div key={c.id}>
                {plCat === "all" && <div className="pl-cat">{c.label}</div>}
                {c.items.map((row) => {
                  const price = asClient
                    ? Number(row.unit_price)
                    : productPrices(row.kind, row.item).landed;
                  return (
                    <div className="pl-row" key={row.prod}>
                      <span className="pl-name">{row.name}</span>
                      <span className={"pl-num" + (asClient ? "" : " muted-num")}>{money(price, asClient ? 4 : 3)}</span>
                      <button className="pl-add" onClick={() => addLine(row.prod, row.name)}>Add to estimate</button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
