import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { supabase } from "../supabaseClient";
import {
  MARGINS, PORTS, findItem, unitEconomics, setEconomics, unitsFromQty, money2,
} from "../lib/pricing";
import { toast } from "./Toaster";
import CustomerCombo from "./CustomerCombo";

const STATUSES = ["Submitted", "In Production", "Shipped", "Delivered"];
const MODES = ["units", "pallets", "containers"]; // per-line quantity units
const ORIGINS = ["India", "China"];
const ORIGIN_ID = { India: "india", China: "china" };

let _liSeq = 0;
const nextLiId = () => ++_liSeq;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Resolve a stored product NAME back to a catalog key ("tub:id" / "lid:id" /
// "set:id") so the line can be re-priced live. Case-insensitive; also matches
// the estimator's set naming (tub name with "Tub"->"Set"). Returns null when
// the product isn't in the current pricing version (e.g. imported cap sizes) —
// those become free-text lines that carry qty/unit without auto-pricing.
function resolveProd(name, data) {
  if (!name || !data) return null;
  const n = String(name).trim().toLowerCase();
  const tub = (data.tubs || []).find((t) => (t.name || "").trim().toLowerCase() === n);
  if (tub) return "tub:" + tub.id;
  const lid = (data.lids || []).find((l) => (l.name || "").trim().toLowerCase() === n);
  if (lid) return "lid:" + lid.id;
  const set = (data.tubs || []).find(
    (t) => (t.name || "").replace(/Tub/i, "Set").trim().toLowerCase() === n
  );
  if (set) return "set:" + set.id;
  return null;
}

// Build one editor line from a stored source object (line_items entry OR a
// legacy pricing.lines entry). Resolves the catalog key so catalog products
// re-price; everything else is a free-text line that keeps its frozen pricing.
function makeLine(src, data) {
  const name = (src.product ?? src.name ?? "").toString();
  const modeRaw = (src.unit ?? src.mode ?? "units").toString();
  const mode = MODES.includes(modeRaw) ? modeRaw : "units";
  const marginLab = src.margin ?? null;
  const prod = resolveProd(name, data);
  const mi = marginLab ? MARGINS.findIndex((m) => m.lab === marginLab) : -1;
  const num = (x) => (x == null || x === "" ? null : Number(x));
  return {
    id: nextLiId(),
    prod,
    name,
    mode,
    qty: src.qty ?? src.units ?? "",
    marginIdx: mi >= 0 ? mi : null,
    freeText: !prod,
    _margin: marginLab,
    _units: num(src.units),
    _unitCharge: num(src.unit_charge),
    _unitCost: num(src.unit_cost),
    _lineCharge: num(src.line_charge ?? src.total_charge),
    _lineCost: num(src.line_cost ?? src.total_cost),
  };
}

// Reconstruct the editor's line list from whatever the order already carries.
function seedRows(job, data) {
  if (Array.isArray(job.line_items) && job.line_items.length) {
    return job.line_items.map((s) => makeLine(s, data));
  }
  const pl = job.pricing?.lines;
  if (Array.isArray(pl) && pl.length) {
    return pl.map((s) => makeLine(s, data));
  }
  // Fall back to parsing the flattened description ("12,960 × 8oz tub").
  if (job.description) {
    const rows = String(job.description)
      .split("\n")
      .map((ln) => ln.match(/^\s*([\d,]+)\s*[×x]\s*(.+?)\s*$/))
      .filter(Boolean)
      .map((m) => makeLine({ product: m[2], qty: Number(m[1].replace(/,/g, "")) || 0, unit: "units" }, data));
    if (rows.length) return rows;
  }
  return [];
}

const EMPTY = {
  job_title: "",
  brand: "",
  description: "",
  qty: 0,
  qty_unit: "tubs",
  cost: "",
  revenue: "",
  status: "Submitted",
  origin: "",
  port: "",
  po_number: "",
  ship_to: "",
  shipping_address: "",
  pricing: null,
  pricing_version_id: null,
};

const num = (x) => Number(x) || 0;
const round2 = (n) => Math.round(n * 100) / 100;
const portIdByName = (name) => PORTS.find((p) => p.name === name)?.id || null;

export default function PlasticJobModal({ job, customers = [], onSave, onClose }) {
  const [form, setForm] = useState({ ...EMPTY, ...job });
  const [tab, setTab] = useState("details");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isNew = !job.id;
  const [uploading, setUploading] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email || "")); }, []);

  const filesBucket = supabase.storage.from("job-files");

  // --- Links tab: projects, tasks, and this order's task links ---------------
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [links, setLinks] = useState([]);
  const [pickProjectId, setPickProjectId] = useState(null); // which project's tasks the picker shows
  const [changingProject, setChangingProject] = useState(false);

  useEffect(() => {
    supabase.from("projects").select("id,name").order("name").then(({ data }) => setProjects(data || []));
    supabase.from("tasks").select("id,project_id,title").then(({ data }) => setTasks(data || []));
  }, []);

  const loadLinks = useCallback(async () => {
    if (!job.id) { setLinks([]); return; }
    const { data } = await supabase.from("work_order_links")
      .select("id,task_id").eq("order_id", job.id).eq("order_kind", "plastic");
    setLinks(data || []);
  }, [job.id]);
  useEffect(() => { loadLinks(); }, [loadLinks]);

  // Auto-match the project by name (order brand == project name, case-insensitive).
  const matchedProject = useMemo(() => {
    const b = (form.brand || "").trim().toLowerCase();
    if (!b) return null;
    return projects.find((p) => (p.name || "").trim().toLowerCase() === b) || null;
  }, [form.brand, projects]);

  const linkedTaskIds = new Set(links.map((l) => l.task_id));
  const linkedProjectIds = new Set(tasks.filter((t) => linkedTaskIds.has(t.id)).map((t) => t.project_id));
  // Project whose tasks the picker shows: manual pick > a linked task's project > name match.
  const activeProjectId = pickProjectId
    || (linkedProjectIds.size ? [...linkedProjectIds][0] : null)
    || matchedProject?.id || null;
  const activeProject = projects.find((p) => p.id === activeProjectId) || null;
  const projectTasks = tasks.filter((t) => t.project_id === activeProjectId && !linkedTaskIds.has(t.id));
  const titleOf = (id) => tasks.find((t) => t.id === id)?.title || "Task";
  const projectOf = (taskId) => {
    const t = tasks.find((x) => x.id === taskId);
    return t ? (projects.find((p) => p.id === t.project_id)?.name || "") : "";
  };

  async function addTaskLink(taskId) {
    if (!taskId) return;
    const { error } = await supabase.from("work_order_links").insert({
      order_id: job.id, order_kind: "plastic", task_id: taskId, created_by: userEmail,
    });
    if (error) { toast.error("Couldn't link task. Please try again."); return; }
    setChangingProject(false);
    toast.success("Task linked");
    loadLinks();
  }
  async function removeTaskLink(linkId) {
    const { error } = await supabase.from("work_order_links").delete().eq("id", linkId);
    if (error) { toast.error("Couldn't remove. Please try again."); return; }
    loadLinks();
  }


  // Persist the current files array onto the order row.
  async function persistFiles(files) {
    setForm((f) => ({ ...f, files }));
    await supabase.from("plastic_jobs").update({ files }).eq("id", job.id);
  }

  async function uploadFiles(fileList) {
    const picked = Array.from(fileList || []).filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (picked.length === 0) { toast.error("Please choose a PDF."); return; }
    setUploading(true);
    try {
      const added = [];
      for (const file of picked) {
        const path = `plastic/${job.id}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
        const { error } = await filesBucket.upload(path, file, { contentType: "application/pdf" });
        if (error) { toast.error("Upload failed. Please try again."); continue; }
        added.push({ name: file.name, path, uploaded_by: userEmail, uploaded_at: new Date().toISOString() });
      }
      if (added.length) {
        const next = [...(form.files || []), ...added];
        await persistFiles(next);
        toast.success(added.length === 1 ? "PDF attached" : `${added.length} PDFs attached`);
      }
    } finally {
      setUploading(false);
    }
  }

  async function removeFile(f) {
    await filesBucket.remove([f.path]);
    await persistFiles((form.files || []).filter((x) => x.path !== f.path));
    toast.success("Attachment removed");
  }

  async function openFile(f) {
    const { data, error } = await filesBucket.createSignedUrl(f.path, 3600);
    if (error) { toast.error("Couldn't open file."); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }


  // Pricing versions (newest first) — drives the product picker.
  const [versions, setVersions] = useState([]);
  useEffect(() => {
    supabase.from("pricing_versions").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setVersions(data || []));
  }, []);
  const version = versions[0] || null;
  const data = version?.data || null;

  // Shared shipping costs (apply to every line's per-piece add-on for tubs).
  const snap = job.pricing || null;
  const [portc, setPortc] = useState(snap?.portc ?? "");
  const [truck, setTruck] = useState(snap?.truck ?? "");

  // --- Multi-product line items ---------------------------------------------
  // UI line: { id, prod|null, name, mode, qty, marginIdx|null, freeText,
  //            _unitCharge?, _unitCost?, _lineCharge?, _lineCost?, _units? }
  // Stored values (prefixed _) preserve pricing for free-text lines that came
  // from a prior estimator/import save and can't be recomputed live.
  const [items, setItems] = useState([]);
  const [seeded, setSeeded] = useState(false);

  // Product catalog search (adds priced lines).
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);
  useEffect(() => {
    function onDown(e) { if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false); }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const addCatalogLine = (prod, name) => {
    setItems((ls) => [...ls, { id: nextLiId(), prod, name, mode: "units", qty: "", marginIdx: null, freeText: false }]);
    setSearch(""); setSearchOpen(false);
  };
  const addFreeLine = () =>
    setItems((ls) => [...ls, { id: nextLiId(), prod: null, name: "", mode: "units", qty: "", marginIdx: null, freeText: true }]);
  const updateItem = (id, patch) => setItems((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeItem = (id) => setItems((ls) => ls.filter((l) => l.id !== id));

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Seed line items once, from (in order): existing line_items, the legacy
  // pricing.lines snapshot, or the flattened description. Waits for pricing
  // `data` so catalog names can resolve to priceable products; if there's no
  // pricing version at all, still seeds (lines become free-text).
  useEffect(() => {
    if (seeded) return;
    if (!version && versions.length === 0) {
      // no pricing table loaded yet — wait unless we truly have none
    }
    // Only seed after the versions query has resolved (version may be null if
    // there genuinely are none). `data` may be null in that case.
    const rows = seedRows(job, data);
    setItems(rows);
    setSeeded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, seeded, versions.length]);

  // Shared freight/ship context for every line (order-level shipping).
  const ship = useMemo(() => {
    const oid = ORIGIN_ID[form.origin];
    const pid = portIdByName(form.port);
    const freight = (data && oid && pid && data.freight?.[oid]?.[pid]) || 0;
    return { freight, portc: num(portc), truck: num(truck) };
  }, [data, form.origin, form.port, portc, truck]);
  const laneReady = !!(ORIGIN_ID[form.origin] && portIdByName(form.port));

  // Price one line. Catalog line → live economics; free-text → carry qty/unit
  // and any stored (frozen) pricing it arrived with.
  function priceItem(l) {
    const qn = num(l.qty);
    if (l.prod && data) {
      const [kind, id] = l.prod.split(":");
      const item = kind === "set" ? data.tubs.find((t) => t.id === id) : findItem(data, id);
      if (item) {
        const econ = kind === "set" ? setEconomics(data, item, ship, {}) : unitEconomics(item, kind, ship, {});
        if (econ) {
          const units = unitsFromQty(item, l.mode, qn);
          const hasMargin = l.marginIdx != null;
          const d = hasMargin ? MARGINS[l.marginIdx].d : null;
          const unitCharge = hasMargin ? econ.sells[l.marginIdx] : null;
          const unitCost = hasMargin ? econ.landed : null; // landed = charge * d
          const lineCharge = unitCharge != null && units != null ? unitCharge * units : null;
          const lineCost = unitCost != null && units != null ? unitCost * units : null;
          return { units, unitCharge, unitCost, lineCharge, lineCost, priceable: true, missingMargin: !hasMargin };
        }
      }
    }
    // Free-text (or unresolved catalog): only "units" mode has a known piece
    // count; preserve any frozen pricing so totals/roll-up stay intact.
    const units = l.mode === "units" ? qn : (l._units ?? null);
    const unitCharge = l._unitCharge ?? null;
    const unitCost = l._unitCost ?? null;
    const lineCharge = l._lineCharge ?? (unitCharge != null && units != null ? unitCharge * units : null);
    const lineCost = l._lineCost ?? (unitCost != null && units != null ? unitCost * units : null);
    return { units, unitCharge, unitCost, lineCharge, lineCost, priceable: false, missingMargin: false };
  }

  const priced = items.map((l) => ({ l, ...priceItem(l) }));

  // Grouped-by-unit totals (units/pallets/containers don't sum together).
  const grouped = useMemo(() => {
    const g = {};
    for (const { l } of priced) {
      const qn = num(l.qty);
      if (!qn) continue;
      g[l.mode] = (g[l.mode] || 0) + qn;
    }
    return g;
  }, [priced]);
  const groupedLabel = MODES
    .filter((m) => grouped[m])
    .map((m) => `${grouped[m].toLocaleString()} ${m}`)
    .join(" · ");
  const totalPieces = priced.reduce((s, p) => s + (p.units || 0), 0);

  // Roll-up of line cost/charge (only lines that have a value contribute).
  const rollCost = priced.reduce((s, p) => s + (p.lineCost || 0), 0);
  const rollCharge = priced.reduce((s, p) => s + (p.lineCharge || 0), 0);
  const anyPriced = priced.some((p) => p.lineCharge != null || p.lineCost != null);
  const needMargin = priced.filter((p) => p.l.prod && p.missingMargin && num(p.l.qty)).length;

  function applyRollup() {
    if (!anyPriced) { toast.error("Add priced products (pick a margin) first."); return; }
    setForm((f) => ({ ...f, cost: round2(rollCost), revenue: round2(rollCharge) }));
    toast.success("Products rolled up — cost & charge filled (still editable)");
  }

  // Persisted line-items shape (source of truth for products).
  function buildLineItems() {
    return priced.map(({ l, units, unitCharge, unitCost, lineCharge, lineCost }) => ({
      product: (l.name || "").trim(),
      qty: num(l.qty),
      unit: l.mode,
      margin: l.marginIdx != null ? MARGINS[l.marginIdx].lab : (l._margin ?? null),
      units: units ?? null,
      unit_cost: unitCost ?? null,
      unit_charge: unitCharge ?? null,
      line_cost: lineCost ?? null,
      line_charge: lineCharge ?? null,
    })).filter((li) => li.product || li.qty);
  }

  function submit(e) {
    e.preventDefault();
    if (!form.job_title.trim()) { setTab("details"); return; }
    const line_items = buildLineItems();
    // Derived order qty (NOT NULL safe): total pieces when known, else the sum
    // of raw line quantities. qty_unit stays "units" (pieces).
    const derivedQty = totalPieces > 0
      ? totalPieces
      : line_items.reduce((s, li) => s + (Number(li.qty) || 0), 0);
    onSave({
      ...form,
      line_items,
      qty: derivedQty,
      qty_unit: "units",
      cost: form.cost === "" || form.cost == null ? null : round2(num(form.cost)),
      revenue: form.revenue === "" || form.revenue == null ? null : round2(num(form.revenue)),
    });
  }

  const profit = (num(form.revenue)) - (num(form.cost));

  // Catalog search results (internal editor always has the full catalog).
  const sq = search.trim().toLowerCase();
  const matchArr = (arr) => (arr || []).filter((x) => (x.name || "").toLowerCase().includes(sq));
  const resTubs = data ? matchArr(data.tubs) : [];
  const resLids = data ? matchArr(data.lids) : [];
  const resSets = data ? matchArr((data.tubs || []).filter((t) => findItem(data, data.sets?.[t.id]))) : [];
  const hasResults = resTubs.length || resLids.length || resSets.length;

  return (
    <div className="overlay">
      <form className="modal modal-tabs" onSubmit={submit}>
        <div className="modal-head">
          <h2>{isNew ? "New Plastics Order" : "Edit Plastics Order"}</h2>
          <div className="modal-tab-bar">
            <button type="button" className={tab === "details" ? "mtab on" : "mtab"} onClick={() => setTab("details")}>Details</button>
            <button type="button" className={tab === "shipping" ? "mtab on" : "mtab"} onClick={() => setTab("shipping")}>Shipping</button>
            <button type="button" className={tab === "files" ? "mtab on" : "mtab"} onClick={() => setTab("files")}>Attachments{form.files?.length ? ` (${form.files.length})` : ""}</button>
            <button type="button" className={tab === "project" ? "mtab on" : "mtab"} onClick={() => setTab("project")}>Project{links.length ? ` (${links.length})` : ""}</button>
          </div>
          <button type="button" className="link" onClick={onClose}>Close</button>
        </div>

        {tab === "details" && (
          <div className="modal-body">
            <label className="field">
              <span>Job Title</span>
              <input value={form.job_title} onChange={(e) => set("job_title", e.target.value)} required autoFocus />
            </label>

            <label className="field">
              <span>Customer</span>
              <CustomerCombo value={form.brand} onChange={(v) => set("brand", v)} customers={customers} />
            </label>

            {/* Products ------------------------------------------------------ */}
            <div className="pm-section-label">Products</div>

            <div className="pli-search" ref={searchRef}>
              <input
                className="pm-input"
                type="text"
                placeholder={data ? "Search products to add…" : "Pricing version still loading…"}
                value={search}
                disabled={!data}
                onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
              />
              {searchOpen && data && (
                <div className="search-dd">
                  {!hasResults && <div className="search-dd-empty">No products match “{search}”. Use “Add custom product”.</div>}
                  {resTubs.length > 0 && <div className="search-dd-cat">Tubs</div>}
                  {resTubs.map((t) => (
                    <button type="button" key={"tub:" + t.id} className="search-dd-item" onClick={() => addCatalogLine("tub:" + t.id, t.name)}>
                      {t.name}<span>+ add</span>
                    </button>
                  ))}
                  {resLids.length > 0 && <div className="search-dd-cat">Lids</div>}
                  {resLids.map((l) => (
                    <button type="button" key={"lid:" + l.id} className="search-dd-item" onClick={() => addCatalogLine("lid:" + l.id, l.name)}>
                      {l.name}<span>+ add</span>
                    </button>
                  ))}
                  {resSets.length > 0 && <div className="search-dd-cat">Sets (tub + lid)</div>}
                  {resSets.map((t) => (
                    <button type="button" key={"set:" + t.id} className="search-dd-item"
                      onClick={() => addCatalogLine("set:" + t.id, t.name.replace(/Tub/i, "Set"))}>
                      {t.name.replace(/Tub/i, "Set")} + lid<span>+ add</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {items.length === 0 ? (
              <p className="muted files-note">No products yet. Search above, or add a custom line.</p>
            ) : (
              <div className="pm-lines">
                {priced.map(({ l, units, unitCharge, lineCharge, priceable, missingMargin }) => (
                  <div className="pm-line" key={l.id}>
                    <div className="pm-line-top">
                      {l.freeText ? (
                        <input
                          className="pm-input pm-line-name"
                          type="text"
                          placeholder="Product name"
                          value={l.name}
                          onChange={(e) => updateItem(l.id, { name: e.target.value })}
                        />
                      ) : (
                        <span className="pm-line-name pm-line-name-fixed">{l.name}</span>
                      )}
                      <span className={"pm-line-total" + (lineCharge == null ? " none" : "")}>
                        {lineCharge == null ? "—" : money2(lineCharge)}
                      </span>
                      <button type="button" className="pm-line-rm" onClick={() => removeItem(l.id)} aria-label={`Remove ${l.name || "line"}`}>×</button>
                    </div>
                    <div className="pm-line-ctrls">
                      <div className="seg">
                        {MODES.map((m) => (
                          <button type="button" key={m} className={l.mode === m ? "on" : ""}
                            onClick={() => updateItem(l.id, { mode: m })}>{cap(m)}</button>
                        ))}
                      </div>
                      <input className="pm-line-qty" type="number" min="0" placeholder="Qty"
                        value={l.qty} onChange={(e) => updateItem(l.id, { qty: e.target.value })} />
                      {priceable ? (
                        <select className={"pm-line-margin" + (missingMargin ? " empty" : "")}
                          value={l.marginIdx ?? ""}
                          onChange={(e) => updateItem(l.id, { marginIdx: e.target.value === "" ? null : +e.target.value })}>
                          <option value="">Margin</option>
                          {MARGINS.map((m, i) => <option key={m.lab} value={i}>{m.lab}</option>)}
                        </select>
                      ) : (
                        <span className="pm-line-flag" title="Not in the pricing version — priced manually below">custom · no auto-price</span>
                      )}
                      {units != null && l.mode !== "units" && (
                        <span className="pm-line-units">{units.toLocaleString()} units</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pm-lines-foot">
              <button type="button" className="btn-ghost" onClick={addFreeLine}>+ Add custom product</button>
              {groupedLabel && (
                <span className="pm-grouped">
                  {groupedLabel}
                  {totalPieces > 0 && <span className="field-hint"> · {totalPieces.toLocaleString()} pieces</span>}
                </span>
              )}
            </div>

            {!data && (
              <p className="field-hint">Freight/margin pricing needs a pricing version. Products still save; set cost &amp; charge manually.</p>
            )}
            {data && !laneReady && items.some((l) => l.prod) && (
              <p className="field-hint">Set Shipping From + Port in the Shipping tab to pull freight into per-unit pricing.</p>
            )}

            {/* Cost / charge -------------------------------------------------- */}
            <div className="field-row">
              <label className="field">
                <span>Total Cost <span className="field-hint">— what we paid</span></span>
                <input type="number" min="0" step="0.01" placeholder="0.00"
                  value={form.cost} onChange={(e) => set("cost", e.target.value)} />
              </label>
              <label className="field">
                <span>Client Charge <span className="field-hint">— what we bill</span></span>
                <input type="number" min="0" step="0.01" placeholder="0.00"
                  value={form.revenue} onChange={(e) => set("revenue", e.target.value)} />
              </label>
            </div>
            {anyPriced && (
              <div className="pm-rollup">
                <span className="muted small">
                  Products roll up to <b>{money2(rollCost)}</b> cost / <b>{money2(rollCharge)}</b> charge
                  {needMargin ? ` · ${needMargin} line${needMargin > 1 ? "s" : ""} need a margin` : ""}
                </span>
                <button type="button" className="btn-ghost" onClick={applyRollup}>Apply to Cost &amp; Charge</button>
              </div>
            )}
            {(form.cost !== "" || form.revenue !== "") && (
              <p className="profit-hint">
                Profit: <b>${profit.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
              </p>
            )}

            <div className="field-row">
              <label className="field">
                <span>Status</span>
                <select value={form.status} onChange={(e) => set("status", e.target.value)}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="field">
                <span>PO Number</span>
                <input value={form.po_number} onChange={(e) => set("po_number", e.target.value)} />
              </label>
            </div>

            <label className="field">
              <span>Notes <span className="field-hint">— optional</span></span>
              <textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
            </label>
          </div>
        )}

        {tab === "shipping" && (
          <div className="modal-body">
            <div className="field-row">
              <label className="field">
                <span>Shipping From</span>
                <select value={form.origin} onChange={(e) => set("origin", e.target.value)}>
                  <option value="">— Select origin —</option>
                  {ORIGINS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Port</span>
                <select value={form.port} onChange={(e) => set("port", e.target.value)}>
                  <option value="">— Select port —</option>
                  {PORTS.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </label>
            </div>

            <div className="field-row">
              <label className="field">
                <span>Port / Customs <span className="field-hint">— feeds per-unit cost</span></span>
                <input type="number" min="0" placeholder="0" value={portc} onChange={(e) => setPortc(e.target.value)} />
              </label>
              <label className="field">
                <span>Trucking <span className="field-hint">— feeds per-unit cost</span></span>
                <input type="number" min="0" placeholder="0" value={truck} onChange={(e) => setTruck(e.target.value)} />
              </label>
            </div>

            <label className="field">
              <span>Ship To</span>
              <input value={form.ship_to} onChange={(e) => set("ship_to", e.target.value)} />
            </label>

            <label className="field">
              <span>Shipping Address</span>
              <textarea rows={3} value={form.shipping_address} onChange={(e) => set("shipping_address", e.target.value)} />
            </label>
          </div>
        )}

        {tab === "files" && (
          <div className="modal-body">
            {isNew ? (
              <p className="muted files-note">Create the order first, then reopen it to attach PDFs.</p>
            ) : (
              <>
                <div className="pfile-drop">
                  <input id="pfile-input" type="file" accept="application/pdf,.pdf" multiple
                    onChange={(e) => uploadFiles(e.target.files)} disabled={uploading} style={{ display: "none" }} />
                  <label htmlFor="pfile-input" className="btn-ghost">{uploading ? "Uploading…" : "+ Attach PDF"}</label>
                  <span className="muted small">PDFs attached to this work order.</span>
                </div>
                {(form.files || []).length === 0 ? (
                  <p className="muted files-note">No attachments yet.</p>
                ) : (
                  <ul className="pfile-list">
                    {(form.files || []).map((f, i) => (
                      <li className="pfile-row" key={f.path || i}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                        <span className="pfile-name" title={f.name}>{f.name}</span>
                        <button type="button" className="link" onClick={() => openFile(f)}>Open</button>
                        <button type="button" className="link danger" onClick={() => removeFile(f)}>Remove</button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {tab === "project" && (
          <div className="modal-body">
            {isNew ? (
              <p className="muted files-note">Create the order first, then reopen it to link tasks.</p>
            ) : (
              <>
                <div className="link-project">
                  <span className="link-project-label">Project</span>
                  {activeProject ? (
                    <span className="link-project-name">
                      <i className="ti" aria-hidden="true"></i>{activeProject.name}
                      {matchedProject && activeProject.id === matchedProject.id && !linkedProjectIds.size && (
                        <span className="link-badge">matched by name</span>
                      )}
                    </span>
                  ) : (
                    <span className="muted">No project matched “{form.brand || "—"}”. Choose one below.</span>
                  )}
                  <button type="button" className="link" onClick={() => setChangingProject((v) => !v)}>
                    {changingProject ? "Done" : "Change"}
                  </button>
                </div>

                {(changingProject || !activeProject) && (
                  <label className="field link-project-picker">
                    <span>Pick a project to browse its tasks</span>
                    <select value={activeProjectId || ""} onChange={(e) => setPickProjectId(e.target.value || null)}>
                      <option value="">— Select a project —</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                )}

                <div className="link-add">
                  <select value="" onChange={(e) => addTaskLink(e.target.value)} disabled={!activeProjectId || projectTasks.length === 0}>
                    <option value="">
                      {!activeProjectId ? "Choose a project first"
                        : projectTasks.length === 0 ? "No more tasks in this project"
                        : "+ Add a task…"}
                    </option>
                    {projectTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                  </select>
                </div>

                {links.length === 0 ? (
                  <p className="muted files-note">No tasks linked yet.</p>
                ) : (
                  <ul className="link-list">
                    {links.map((l) => (
                      <li className="link-row" key={l.id}>
                        <i className="ti ti-checkbox" style={{ fontSize: 16 }} aria-hidden="true"></i>
                        <span className="link-name">{titleOf(l.task_id)}</span>
                        <span className="link-proj muted">{projectOf(l.task_id)}</span>
                        <button type="button" className="link danger" onClick={() => removeTaskLink(l.id)}>Remove</button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="muted files-note">Linked tasks show this order on the project’s Work orders tab.</div>
              </>
            )}
          </div>
        )}

        <div className="modal-foot">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-accent">{isNew ? "Create order" : "Save changes"}</button>
        </div>
      </form>
    </div>
  );
}
