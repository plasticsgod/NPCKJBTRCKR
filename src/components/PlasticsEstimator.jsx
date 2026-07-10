import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "../supabaseClient";
import {
  MARGINS, ORIGINS, PORTS,
  findItem, unitEconomics, setEconomics, unitsFromQty, money, money2,
} from "../lib/pricing";
import PricingEditor from "./PricingEditor";
import { buildQuotePDF } from "../lib/quotePdf";
import { toast } from "./Toaster";

let _lineSeq = 0;
const nextLineId = () => ++_lineSeq;
const cap = (s) => s[0].toUpperCase() + s.slice(1);

export default function PlasticsEstimator({ userEmail }) {
  const [versions, setVersions] = useState([]);
  const [vi, setVi] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);

  // Shipping (internal only). Freight is typed manually — no auto-fill.
  const [ship, setShip] = useState({ origin: "", port: "", freight: 0, portc: 0, truck: 0, ware: 0 });

  // Store-style quote: each line = product + unit + qty + margin.
  const [lines, setLines] = useState([]);

  // Product search
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [plCat, setPlCat] = useState("all");
  const searchRef = useRef(null);

  const loadVersions = useCallback(async () => {
    const { data, error } = await supabase
      .from("pricing_versions").select("*").order("created_at", { ascending: false });
    if (error) console.error("Load pricing failed:", error.message);
    else { setVersions(data ?? []); setVi(0); }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadVersions();
    const ch = supabase.channel("pricing-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "pricing_versions" }, loadVersions)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [loadVersions]);

  useEffect(() => {
    function onDown(e) { if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false); }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  if (loading) return <div className="muted pad">Loading pricing…</div>;
  if (versions.length === 0)
    return (
      <div className="empty">
        <p className="empty-title">No pricing yet</p>
        <p className="muted">Run the pricing setup SQL in Supabase to seed the first version.</p>
      </div>
    );

  const version = versions[vi];
  const data = version.data; // { tubs, lids, sets, freight }

  // Tariffs come straight from the version (edited via "Edit pricing").
  const ov = {};
  [...data.tubs, ...data.lids].forEach((i) => (ov[i.id] = i.tariff ?? 0));

  const updateShip = (k, v) => setShip((s) => ({ ...s, [k]: v }));

  // --- grouped search results -------------------------------------------------
  const q = search.trim().toLowerCase();
  const match = (arr) => arr.filter((x) => x.name.toLowerCase().includes(q));
  const resTubs = match(data.tubs);
  const resLids = match(data.lids);
  const resSets = match(data.tubs); // sets are named from their tub
  const hasResults = resTubs.length || resLids.length || resSets.length;

  function addLine(prod, name) {
    setLines((ls) => [...ls, { id: nextLineId(), prod, name, mode: "units", qty: "", marginIdx: null }]);
    setSearch(""); setSearchOpen(false);
  }
  const updateLine = (id, patch) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id) => setLines((ls) => ls.filter((l) => l.id !== id));

  // Price one builder line. Returns display values + a "saved" shape for PDF/save.
  function priceLine(l) {
    const [kind, id] = l.prod.split(":");
    const item = kind === "set" ? data.tubs.find((t) => t.id === id) : findItem(data, id);
    if (!item) return { unit: null, units: null, total: null, saved: null };
    const econ = kind === "set" ? setEconomics(data, item, ship, ov) : unitEconomics(item, kind, ship, ov);
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

  const priced = lines.map((l) => ({ l, ...priceLine(l) }));
  const savedLines = priced.map((p) => p.saved).filter(Boolean);
  const total = savedLines.reduce((a, s) => a + s.total, 0);
  const needMargin = priced.filter((p) => p.l.marginIdx == null).length;

  // Per-unit prices for the catalog at the bottom (reflects current shipping).
  function productPrices(kind, item) {
    const econ = kind === "set" ? setEconomics(data, item, ship, ov) : unitEconomics(item, kind, ship, ov);
    return { landed: econ.landed, sells: econ.sells };
  }

  // Catalog grouped by category. Add a new category here (e.g. "glass") and it
  // appears as a tab + section automatically.
  const catalog = [
    { id: "tubs", label: "Tubs", items: data.tubs.map((t) => ({ prod: "tub:" + t.id, name: t.name, item: t, kind: "tub" })) },
    { id: "lids", label: "Lids", items: data.lids.map((l) => ({ prod: "lid:" + l.id, name: l.name, item: l, kind: "lid" })) },
    { id: "sets", label: "Sets", items: data.tubs.map((t) => ({ prod: "set:" + t.id, name: t.name.replace("Tub", "Set") + " + lid", item: t, kind: "set" })) },
  ];

  async function saveQuote() {
    if (savedLines.length === 0) { toast.error("Add at least one line with a margin first."); return; }
    const { error } = await supabase.from("plastic_quotes").insert({
      created_by: userEmail, customer: null, lines: savedLines, total,
    });
    if (error) { toast.error("Couldn't save quote — " + error.message); return; }
    toast.success("Quote saved");
  }
  function exportPdf() {
    if (savedLines.length === 0) { toast.error("Add at least one line with a margin first."); return; }
    buildQuotePDF({ customer: null, lines: savedLines });
  }

  return (
    <div className="estv2">
      <div className="estv2-head">
        <div className="estv2-title">
          <h1 className="page-h1">Plastics Estimator</h1>
          {versions.length > 1 && (
            <select className="ver-select" value={vi} onChange={(e) => setVi(+e.target.value)}>
              {versions.map((v, i) => (
                <option key={v.id} value={i}>{v.version_date} — {v.label}{i === 0 ? " (current)" : ""}</option>
              ))}
            </select>
          )}
        </div>
        <button className="btn-ghost" onClick={() => setEditorOpen(true)}>Edit pricing</button>
      </div>

      {/* Shipping strip — internal only; freight typed manually */}
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

      {/* Product search */}
      <div className="prod-search" ref={searchRef}>
        <div className="prod-search-box">
          <span className="ps-icon" aria-hidden="true">⌕</span>
          <input value={search} placeholder="Add a product…"
            onFocus={() => setSearchOpen(true)}
            onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }} />
        </div>
        {searchOpen && (
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
                <select className={"qline-margin" + (l.marginIdx == null ? " empty" : "")}
                  value={l.marginIdx ?? ""}
                  onChange={(e) => updateLine(l.id, { marginIdx: e.target.value === "" ? null : +e.target.value })}>
                  <option value="">Pick margin</option>
                  {MARGINS.map((m, i) => <option key={i} value={i}>{m.lab}</option>)}
                </select>
                {units != null && unit != null && l.mode !== "units" && (
                  <span className="qline-units">{units.toLocaleString()} units</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {lines.length > 0 && (
        <>
          <div className="quote-total-bar">
            <span className="qtb-label">
              Total{needMargin ? <span className="qtb-note"> · {needMargin} line{needMargin > 1 ? "s" : ""} need a margin</span> : ""}
            </span>
            <span className="qtb-total">{money2(total)}</span>
          </div>
          <div className="quote-actions">
            <button className="btn-ghost" onClick={saveQuote}>Save quote</button>
            <button className="btn-accent" onClick={exportPdf}>Export PDF</button>
          </div>
        </>
      )}

      {editorOpen && (
        <PricingEditor baseData={data} userEmail={userEmail}
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
              <span className="pl-name">Product</span><span className="pl-num">Landed</span><span></span>
            </div>
            {catalog.filter((c) => plCat === "all" || plCat === c.id).map((c) => (
              <div key={c.id}>
                {plCat === "all" && <div className="pl-cat">{c.label}</div>}
                {c.items.map((row) => {
                  const pr = productPrices(row.kind, row.item);
                  return (
                    <div className="pl-row" key={row.prod}>
                      <span className="pl-name">{row.name}</span>
                      <span className="pl-num muted-num">{money(pr.landed, 3)}</span>
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
