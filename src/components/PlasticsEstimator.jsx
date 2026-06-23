import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import {
  MARGINS, ORIGINS, PORTS, fbxLane, SAMPLE_MARKET,
  containerCosts, findItem, unitEconomics, setEconomics, unitsFromQty,
  money, money2,
} from "../lib/pricing";
import PriceList from "./PriceList";
import DraftQuote from "./DraftQuote";
import PricingEditor from "./PricingEditor";
import { buildQuotePDF } from "../lib/quotePdf";

export default function PlasticsEstimator({ userEmail }) {
  const [versions, setVersions] = useState([]);
  const [vi, setVi] = useState(0); // index into versions (0 = current/newest)
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);

  // Shipping inputs (on-screen only, never published)
  const [ship, setShip] = useState({ origin: "", port: "", freight: 0, portc: 0, truck: 0, ware: 0 });
  const [tariffOv, setTariffOv] = useState({});
  const [market] = useState(SAMPLE_MARKET);

  // Quote builder selections
  const [prod, setProd] = useState("");
  const [mode, setMode] = useState("units");
  const [qty, setQty] = useState("");
  const [marginIdx, setMarginIdx] = useState(0);

  // Draft quote basket
  const [quote, setQuote] = useState({ customer: "", lines: [] });

  const loadVersions = useCallback(async () => {
    const { data, error } = await supabase
      .from("pricing_versions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) console.error("Load pricing failed:", error.message);
    else {
      setVersions(data ?? []);
      setVi(0);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadVersions();
    const ch = supabase
      .channel("pricing-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "pricing_versions" }, loadVersions)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [loadVersions]);

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

  // Sync tariff overrides whenever the active version changes
  function activeTariffs() {
    const ov = {};
    [...data.tubs, ...data.lids].forEach((i) => (ov[i.id] = tariffOv[i.id] ?? i.tariff));
    return ov;
  }
  const ov = activeTariffs();

  function applyLane(originId, portId) {
    setShip((s) => {
      const next = { ...s, origin: originId, port: portId };
      const o = ORIGINS.find((x) => x.id === originId);
      const p = PORTS.find((x) => x.id === portId);
      if (o && p && data.freight[originId]) next.freight = data.freight[originId][portId] ?? 0;
      return next;
    });
  }

  function resolveProduct() {
    if (!prod) return null;
    const [kind, id] = prod.split(":");
    if (kind === "set") return { kind, item: data.tubs.find((t) => t.id === id) };
    return { kind, item: findItem(data, id) };
  }

  function currentLine() {
    const rp = resolveProduct();
    if (!rp) return null;
    const q = parseFloat(qty) || 0;
    const { kind, item } = rp;
    let econ, name;
    if (kind === "set") { econ = setEconomics(data, item, ship, ov); name = item.name.replace("Tub", "Set"); }
    else { econ = unitEconomics(item, kind, ship, ov); name = item.name; }
    const units = unitsFromQty(item, mode, q);
    if (units === null || units <= 0) return null;
    const unit = econ.sells[marginIdx];
    const freightU = kind === "set" ? unitEconomics(item, "tub", ship, ov).addOn : econ.addOn;
    const dutyU = kind === "set" ? (ov[item.id] || 0) + (ov[econ.lid.id] || 0) : econ.tariff;
    return { name, units, unit, total: unit * units, marginLab: MARGINS[marginIdx].lab, freightU, dutyU, dutyIncluded: kind === "lid" };
  }

  function addToQuote() {
    const l = currentLine();
    if (!l) return;
    setQuote((qu) => ({ ...qu, lines: [...qu.lines, l] }));
  }

  // Result panel data
  const rp = resolveProduct();
  let result = null;
  if (rp) {
    const { kind, item } = rp;
    const q = parseFloat(qty) || 0;
    let econ, name, pcs;
    if (kind === "set") { econ = setEconomics(data, item, ship, ov); name = item.name.replace("Tub", "Set"); pcs = item.pcs; }
    else { econ = unitEconomics(item, kind, ship, ov); name = item.name; pcs = item.pcs; }
    const units = unitsFromQty(item, mode, q);
    result = { kind, item, econ, name, pcs, units };
  }

  return (
    <div className="estimator">
      <div className="est-toolbar">
        <div className="fld">
          <label>Pricing Version</label>
          <select className="inp" value={vi} onChange={(e) => setVi(+e.target.value)}>
            {versions.map((v, i) => (
              <option key={v.id} value={i}>
                {v.version_date} — {v.label}{i === 0 ? " (current)" : ""}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-accent push-right" onClick={() => setEditorOpen(true)}>
          Edit pricing
        </button>
      </div>

      <div className="est-grid">
        {/* LEFT: lane + shipping + quote builder */}
        <div className="est-col">
          <section className="panel-card">
            <h3 className="card-h">Lane &amp; Freight</h3>
            <div className="field-row">
              <label className="field">
                <span>Origin</span>
                <select value={ship.origin} onChange={(e) => applyLane(e.target.value, ship.port)}>
                  <option value="">Select origin…</option>
                  {ORIGINS.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>US Port</span>
                <select value={ship.port} onChange={(e) => applyLane(ship.origin, e.target.value)}>
                  <option value="">Select US port…</option>
                  {PORTS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            </div>

            <MarketCard ship={ship} market={market} />

            <div className="ship-grid">
              {[["freight", "Container freight"], ["portc", "Port / customs"], ["truck", "Trucking"], ["ware", "Warehouse"]].map(([k, lab]) => (
                <label className="field" key={k}>
                  <span>{lab}</span>
                  <input type="number" min="0" value={ship[k]}
                    onChange={(e) => setShip((s) => ({ ...s, [k]: parseFloat(e.target.value) || 0 }))} />
                </label>
              ))}
            </div>
            <p className="ship-total">Container costs: <b>{money2(containerCosts(ship))}</b></p>
          </section>

          <section className="panel-card">
            <h3 className="card-h">Quote Builder</h3>
            <label className="field">
              <span>Product</span>
              <select value={prod} onChange={(e) => setProd(e.target.value)}>
                <option value="">Select a product…</option>
                <optgroup label="Tubs — India">
                  {data.tubs.map((t) => <option key={t.id} value={"tub:" + t.id}>{t.name}</option>)}
                </optgroup>
                <optgroup label="Lids — China">
                  {data.lids.map((l) => <option key={l.id} value={"lid:" + l.id}>{l.name}</option>)}
                </optgroup>
                <optgroup label="Sets (Tub + Lid)">
                  {data.tubs.map((t) => <option key={t.id} value={"set:" + t.id}>{t.name.replace("Tub", "Set")} + {data.sets[t.id]} lid</option>)}
                </optgroup>
              </select>
            </label>

            <div className="field-row">
              <label className="field">
                <span>Quantity in</span>
                <div className="seg">
                  {["units", "pallets", "containers"].map((m) => (
                    <button key={m} type="button" className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
                      {m[0].toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>
              </label>
              <label className="field">
                <span>Quantity</span>
                <input type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
              </label>
            </div>

            <label className="field">
              <span>Quote at margin</span>
              <select value={marginIdx} onChange={(e) => setMarginIdx(+e.target.value)}>
                {MARGINS.map((m, i) => <option key={i} value={i}>{m.lab} margin</option>)}
              </select>
            </label>

            <ResultPanel result={result} ship={ship} ov={ov} mode={mode} qty={qty} marginIdx={marginIdx} data={data} />

            <button className="btn-accent full" style={{ marginTop: 14 }} onClick={addToQuote} disabled={!currentLine()}>
              Add to draft quote
            </button>
          </section>
        </div>

        {/* RIGHT: draft quote + price list */}
        <div className="est-col">
          <DraftQuote
            quote={quote}
            setQuote={setQuote}
            onPdf={() => buildQuotePDF(quote)}
          />
        </div>
      </div>

      <PriceList data={data} ship={ship} ov={ov} setTariffOv={setTariffOv} />

      <footer className="est-footer">
        Active pricing · {version.version_date} · {version.label} · signed by {version.signer || "—"}
      </footer>

      {editorOpen && (
        <PricingEditor
          baseData={data}
          userEmail={userEmail}
          onClose={() => setEditorOpen(false)}
          onPublished={() => { setEditorOpen(false); loadVersions(); }}
        />
      )}
    </div>
  );
}

// --- Market reference card --------------------------------------------------
function MarketCard({ ship, market }) {
  if (!ship.origin || !ship.port) return null;
  const port = PORTS.find((p) => p.id === ship.port);
  const lane = fbxLane(ship.origin, port?.coast);
  const isSample = (market.updated || "").includes("sample");
  if (!lane) {
    return (
      <div className="market">
        <span className="market-lab">Market reference</span>
        <span className="market-note">No headline index for India lanes — benchmark covers China → US only.</span>
      </div>
    );
  }
  const rate = market.lanes?.[lane.code];
  return (
    <div className="market">
      <div className="market-row">
        <span className="market-lab">{lane.name}{isSample ? " · sample" : " · live"}</span>
        <span className="market-rate">{money2(rate)} <small>/ FEU</small></span>
      </div>
      <span className="market-note">
        Your manual freight: {money2(ship.freight)} · {isSample ? "Sample data — not a live quote." : "Market benchmark vs your rate."}
      </span>
    </div>
  );
}

// --- Result breakdown panel -------------------------------------------------
function ResultPanel({ result, ship, ov, mode, qty, marginIdx, data }) {
  if (!result) return <div className="breakdown-box muted">Select a product to begin a quote.</div>;
  const { kind, item, econ, name, pcs, units } = result;
  if (units === null) {
    const what = mode === "pallets" ? "pallet count" : "pcs-per-container";
    return <div className="breakdown-box">No {what} on file for this item. Switch to “Units”.</div>;
  }
  const s = econ.sells;
  const sfx = mode === "pallets" ? ` · ${qty} plt` : mode === "containers" ? ` · ${qty} ctnr` : "";
  const factory = kind === "set" ? item.factory + econ.lid.factory : item.factory;
  const addOn = kind === "set" ? unitEconomics(item, "tub", ship, ov).addOn : econ.addOn;
  const tariff = kind === "set" ? (ov[item.id] || 0) + (ov[econ.lid.id] || 0) : econ.tariff;

  return (
    <div className="breakdown-box dark">
      <div className="bd-head"><span>{name}</span><span>{units.toLocaleString()} units{sfx}</span></div>
      <div className="bd-rows">
        <div className="bd-row"><span>{kind === "set" ? "Tub + lid factory" : "Factory cost"}</span><span className="num">{money(factory)}</span></div>
        <div className="bd-row"><span>{kind === "set" ? "Tub add-on / unit" : "Add-on / unit"}</span><span className="num">{money(addOn)}</span></div>
        <div className="bd-row">
          <span>{kind === "lid" ? "Duty / tariff" : "Tariff / unit"}</span>
          <span className="num">{kind === "lid" ? <em>included in pricing</em> : money(tariff)}</span>
        </div>
        <div className="bd-row landed"><span>Landed cost / unit</span><span className="num">{money(econ.landed)}</span></div>
      </div>
      <div className="bd-margins">
        {MARGINS.map((mg, i) => (
          <div className={"bd-mcell " + (i === marginIdx ? "hero" : "")} key={i}>
            <div className="bd-mlab">{mg.lab} margin</div>
            <div className="bd-mbig num">{money(s[i], 3)}</div>
          </div>
        ))}
      </div>
      <div className="bd-totals">
        {MARGINS.map((mg, i) => (
          <div className="bd-row" key={i}>
            <span>{i === marginIdx ? <b>Line total @ {mg.lab}</b> : `Line total @ ${mg.lab}`}</span>
            <span className="num">{money2(s[i] * units)}</span>
          </div>
        ))}
        {pcs && kind !== "set" && (
          <div className="bd-row fc"><b>Full container @ {MARGINS[marginIdx].lab}</b><span className="num">{money2(s[marginIdx] * pcs)}</span></div>
        )}
      </div>
    </div>
  );
}
