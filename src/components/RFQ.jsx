import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../supabaseClient";
import { toast } from "./Toaster";

// Stick-pack builder defaults. Everything lives in the rfqs.data JSONB blob, so
// adding labels/cartons/boxes later needs no migration.
const EMPTY = {
  category: "stick_packs",
  scope: "Packaging only — no filling",
  project_ref: "",
  skus: "2",
  components_per_sku: "Stick + gusseted sachet",
  sticks_per_sachet: "28",
  qty_per_variant: "",
  sachets_per_variant: "",
  overage_pct: "8",
  sachet_stock: "Premade",
  lamination: "Matte",
  food_grade: "Required",
  color_system: "Process CMYK",
  color_match: "Must match — no exceptions",
  press_tech: "Supplier's choice (digital or conventional)",
  artwork_status: "For quoting only — proofing to follow",
  freight: "Handled by NutraPack",
  shelf_life: "",
  respond_by: "",
  vendors: [""],
  notes: "",
  attachments: [],           // [{ name, path, size }]
  cost_targets: { stick: "", sachet: "", ceiling: "", strategy: "" }, // internal-only
};

const PRESS_OPTS = [
  "Supplier's choice (digital or conventional)",
  "Digital only",
  "Conventional only",
  "JetFX",
];

const fmtInt = (n) => (isNaN(n) ? "—" : Math.round(n).toLocaleString("en-US"));
const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
};

export default function RFQ({ userEmail }) {
  const [view, setView] = useState("list");   // list | builder
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  async function load() {
    const { data, error } = await supabase.from("rfqs").select("*").order("created_at", { ascending: false });
    if (error) { toast.error("Couldn't load RFQs."); setLoading(false); return; }
    setRows(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  function newRFQ() { setEditingId(null); setForm(EMPTY); setView("builder"); }
  function openRFQ(r) {
    setEditingId(r.id);
    setForm({ ...EMPTY, ...(r.data || {}), project_ref: r.project_ref || r.data?.project_ref || "" });
    setView("builder");
  }

  // Overage math
  const oQty = useMemo(() => (Number(form.qty_per_variant) || 0) * (1 + (Number(form.overage_pct) || 0) / 100), [form.qty_per_variant, form.overage_pct]);
  const oSach = useMemo(() => (Number(form.sachets_per_variant) || 0) * (1 + (Number(form.overage_pct) || 0) / 100), [form.sachets_per_variant, form.overage_pct]);

  // Vendors
  const setVendor = (i, v) => setForm((f) => { const a = [...f.vendors]; a[i] = v; return { ...f, vendors: a }; });
  const addVendor = () => setForm((f) => ({ ...f, vendors: [...f.vendors, ""] }));
  const removeVendor = (i) => setForm((f) => ({ ...f, vendors: f.vendors.filter((_, x) => x !== i) }));

  // Attachments — upload to the rfq-files bucket, keep {name,path,size} in the blob.
  async function onFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => /\.pdf$/i.test(f.name));
    if (!files.length) return;
    const added = [];
    for (const f of files) {
      const path = `${editingId || "draft"}/${Date.now()}-${f.name}`.replace(/\s+/g, "_");
      const { error } = await supabase.storage.from("rfq-files").upload(path, f, { upsert: false });
      if (error) { toast.error(`Couldn't upload ${f.name}.`); continue; }
      added.push({ name: f.name, path, size: f.size });
    }
    if (added.length) setForm((f) => ({ ...f, attachments: [...f.attachments, ...added] }));
  }
  const removeAttachment = (path) => setForm((f) => ({ ...f, attachments: f.attachments.filter((a) => a.path !== path) }));
  const fmtSize = (b) => (b > 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1e3)) + " KB");

  async function save() {
    if (!form.project_ref.trim()) { toast.error("Add a project reference."); return; }
    setSaving(true);
    const payload = {
      project_ref: form.project_ref.trim(),
      category: form.category,
      data: form,
      created_by: userEmail,
    };
    let error;
    if (editingId) {
      ({ error } = await supabase.from("rfqs").update(payload).eq("id", editingId));
    } else {
      const res = await supabase.from("rfqs").insert(payload).select("id").single();
      error = res.error;
      if (!error && res.data) setEditingId(res.data.id);
    }
    setSaving(false);
    if (error) { toast.error("Couldn't save the RFQ."); return; }
    toast.success("RFQ saved.");
    load();
  }

  // -------------------------------------------------------------- list view
  if (view === "list") {
    return (
      <div className="page-card">
        <div className="page-head">
          <div className="page-head-left">
            <h1 className="page-title">Requests for quotation</h1>
            <span className="page-meta">{rows.length} {rows.length === 1 ? "RFQ" : "RFQs"}</span>
          </div>
          <div className="page-head-right">
            <button className="btn-accent" onClick={newRFQ}>+ New RFQ</button>
          </div>
        </div>

        {loading ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="empty">
            <p className="empty-title">No RFQs yet</p>
            <p className="muted">Create one to send suppliers a request for quotation.</p>
            <button className="btn-accent" onClick={newRFQ}>+ New RFQ</button>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>RFQ #</th><th>Project</th><th>Category</th><th>Status</th><th className="num">Vendors</th><th>Created</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="row" onClick={() => openRFQ(r)}>
                    <td className="cell-title">{r.rfq_number || "—"}</td>
                    <td>{r.project_ref || "—"}</td>
                    <td>{(r.category || "").replace(/_/g, " ")}</td>
                    <td><span className={`pill pill-${(r.status || "draft")}`}>{r.status || "draft"}</span></td>
                    <td className="num">{(r.data?.vendors || []).filter(Boolean).length}</td>
                    <td>{fmtDate(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------ builder view
  const hasFiles = form.attachments.length > 0;
  return (
    <div className="page-card">
      <div className="page-head">
        <div className="page-head-left">
          <h1 className="page-title">{editingId ? "Edit RFQ" : "New request for quotation"}</h1>
          <span className="page-meta">Stick packs</span>
        </div>
        <div className="page-head-right">
          <button className="btn-ghost" onClick={() => { setView("list"); load(); }}>Back</button>
          <button className="btn-accent" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save RFQ"}</button>
        </div>
      </div>

      <div className="rfq-form">
        <div className="pm-section-label">Category</div>
        <div className="field-row">
          <label className="field"><span>Product type</span>
            <select value={form.category} onChange={(e) => set("category", e.target.value)}>
              <option value="stick_packs">Stick packs</option>
              <option value="labels" disabled>Labels (coming soon)</option>
              <option value="cartons" disabled>Cartons (coming soon)</option>
              <option value="boxes" disabled>Boxes (coming soon)</option>
            </select>
          </label>
          <label className="field"><span>Turnkey scope</span>
            <select value={form.scope} onChange={(e) => set("scope", e.target.value)}>
              <option>Packaging only — no filling</option><option>Packaging + fill</option>
            </select>
          </label>
        </div>

        <div className="pm-section-label">Job &amp; SKUs</div>
        <div className="field-row">
          <label className="field"><span>Project reference</span><input value={form.project_ref} onChange={(e) => set("project_ref", e.target.value)} /></label>
          <label className="field"><span>Finished SKUs</span><input value={form.skus} onChange={(e) => set("skus", e.target.value)} /></label>
        </div>
        <div className="field-row">
          <label className="field"><span>Components per SKU</span><input value={form.components_per_sku} onChange={(e) => set("components_per_sku", e.target.value)} /></label>
          <label className="field"><span>Sticks per sachet</span><input value={form.sticks_per_sachet} onChange={(e) => set("sticks_per_sachet", e.target.value)} /></label>
        </div>

        <div className="pm-section-label">Quantities <span className="field-hint">— overage auto-calculated</span></div>
        <div className="field-row">
          <label className="field"><span>Sticks per variant</span><input type="number" value={form.qty_per_variant} onChange={(e) => set("qty_per_variant", e.target.value)} /></label>
          <label className="field"><span>Sachets per variant</span><input type="number" value={form.sachets_per_variant} onChange={(e) => set("sachets_per_variant", e.target.value)} /></label>
          <label className="field"><span>Overage %</span><input type="number" value={form.overage_pct} onChange={(e) => set("overage_pct", e.target.value)} /></label>
        </div>
        <div className="rfq-calc"><span>Sticks with overage</span><b>{fmtInt(oQty)}</b></div>
        <div className="rfq-calc"><span>Sachets with overage</span><b>{fmtInt(oSach)}</b></div>

        <div className="pm-section-label">Materials &amp; print</div>
        <div className="field-row">
          <label className="field"><span>Sachet stock</span><select value={form.sachet_stock} onChange={(e) => set("sachet_stock", e.target.value)}><option>Premade</option><option>Roll stock</option></select></label>
          <label className="field"><span>Lamination</span><select value={form.lamination} onChange={(e) => set("lamination", e.target.value)}><option>Matte</option><option>Gloss</option></select></label>
        </div>
        <div className="field-row">
          <label className="field"><span>Food grade</span><select value={form.food_grade} onChange={(e) => set("food_grade", e.target.value)}><option>Required</option><option>Not required</option></select></label>
          <label className="field"><span>Color system</span><select value={form.color_system} onChange={(e) => set("color_system", e.target.value)}><option>Process CMYK</option><option>Pantone / spot</option></select></label>
        </div>
        <div className="field-row">
          <label className="field"><span>Color match</span><select value={form.color_match} onChange={(e) => set("color_match", e.target.value)}><option>Must match — no exceptions</option><option>Reference only</option></select></label>
          <label className="field"><span>Press technology</span><select value={form.press_tech} onChange={(e) => set("press_tech", e.target.value)}>{PRESS_OPTS.map((o) => <option key={o}>{o}</option>)}</select></label>
        </div>

        <div className="pm-section-label">Commercial &amp; status</div>
        <div className="field-row">
          <label className="field"><span>Artwork status</span><select value={form.artwork_status} onChange={(e) => set("artwork_status", e.target.value)}><option>For quoting only — proofing to follow</option><option>Final / production-ready</option></select></label>
          <label className="field"><span>Freight</span><select value={form.freight} onChange={(e) => set("freight", e.target.value)}><option>Handled by NutraPack</option><option>Supplier delivers</option></select></label>
        </div>
        <div className="field-row">
          <label className="field"><span>Shelf life target</span><input value={form.shelf_life} onChange={(e) => set("shelf_life", e.target.value)} placeholder="e.g. 24 months" /></label>
          <label className="field"><span>Respond by</span><input type="date" value={form.respond_by} onChange={(e) => set("respond_by", e.target.value)} /></label>
        </div>

        <div className="pm-section-label">Vendors <span className="field-hint">— one RFQ per vendor, re-addressed</span></div>
        {form.vendors.map((v, i) => (
          <div className="rfq-vend" key={i}>
            <input value={v} onChange={(e) => setVendor(i, e.target.value)} placeholder="Vendor name" />
            <button type="button" className="rfq-x" onClick={() => removeVendor(i)} aria-label="Remove vendor">×</button>
          </div>
        ))}
        <button type="button" className="btn-ghost rfq-addvend" onClick={addVendor}>+ Add vendor</button>

        <div className="pm-section-label">Attachments <span className="field-hint">— merged onto the RFQ PDF, listed as enclosures</span></div>
        <label className="rfq-drop">
          <input ref={fileRef} type="file" accept="application/pdf" multiple style={{ display: "none" }}
            onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
          <span className="rfq-drop-main">Drag &amp; drop PDFs here</span>
          <span className="field-hint">or</span>
          <span className="rfq-drop-btn">Select PDFs</span>
        </label>
        {hasFiles && (
          <div className="rfq-files">
            {form.attachments.map((a) => (
              <div className="rfq-file" key={a.path}>
                <span className="rfq-file-tag">PDF</span>
                <span className="rfq-file-name" title={a.name}>{a.name}</span>
                <span className="rfq-file-meta muted small">{fmtSize(a.size)}</span>
                <button type="button" className="rfq-x" onClick={() => removeAttachment(a.path)} aria-label={`Remove ${a.name}`}>×</button>
              </div>
            ))}
          </div>
        )}

        <div className="pm-section-label">Additional notes <span className="field-hint">— appears on the outbound RFQ</span></div>
        <label className="field"><textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Supplier-facing notes: tear notch, reclose, regulatory market, secondary cartons in/out of scope…" /></label>

        <div className="pm-section-label">Internal targets <span className="field-hint">— never sent to suppliers</span></div>
        <div className="field-row">
          <label className="field"><span>Target landed / stick</span><input value={form.cost_targets.stick} onChange={(e) => set("cost_targets", { ...form.cost_targets, stick: e.target.value })} placeholder="$0.000" /></label>
          <label className="field"><span>Target landed / sachet</span><input value={form.cost_targets.sachet} onChange={(e) => set("cost_targets", { ...form.cost_targets, sachet: e.target.value })} placeholder="$0.000" /></label>
        </div>
        <label className="field"><span>Vendor strategy <span className="field-hint">(internal)</span></span>
          <textarea rows={2} value={form.cost_targets.strategy} onChange={(e) => set("cost_targets", { ...form.cost_targets, strategy: e.target.value })} placeholder="Leverage, walk-away notes — stays in-house." />
        </label>

        <p className="muted small rfq-note">Generating the PDFs (outbound RFQ + internal spec, with attachments merged) comes next — save the RFQ first.</p>
      </div>
    </div>
  );
}
