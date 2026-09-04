import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabaseClient";
import { toast } from "./Toaster";
import { downloadOutboundRFQ, downloadInternalSpec } from "../lib/rfqPdf";

// Stick-pack builder defaults. Everything lives in the rfqs.data JSONB blob, so
// adding labels/cartons/boxes later needs no migration.
const EMPTY = {
  category: "stick_packs",
  scope: "",
  project_ref: "",
  product: "",
  skus: "",
  components_per_sku: "",
  sticks_per_sachet: "",
  variants: [{ size: "", qty: "", sachets: "", overage: "8" }],
  sachet_stock: "",
  lamination: "",
  food_grade: "",
  color_system: "",
  color_match: "",
  press_tech: "",
  artwork_status: "",
  freight: "",
  shelf_life: "",
  respond_by: "",
  vendors: [""],
  notes: "",
  attachments: [],           // [{ name, path, size }]
  cost_targets: { stick: "", sachet: "", ceiling: "", strategy: "" }, // internal-only
};

// Old RFQs stored single-size fields. Convert them to one variant on load so
// nothing breaks. Returns a data object guaranteed to have a `variants` array.
function withVariants(data) {
  const d = { ...data };
  if (!Array.isArray(d.variants) || d.variants.length === 0) {
    d.variants = [{
      size: "",
      qty: d.qty_per_variant ?? "",
      sachets: d.sachets_per_variant ?? "",
      overage: d.overage_pct ?? "8",
    }];
  }
  return d;
}


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

export default function RFQ({ userEmail, openId, onOpened }) {
  const [view, setView] = useState("list");   // list | builder
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [status, setStatus] = useState("draft");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  async function load() {
    const { data, error } = await supabase.from("rfqs").select("*").order("created_at", { ascending: false });
    if (error) { toast.error("Couldn't load RFQs."); setLoading(false); return; }
    setRows(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Deep-link from a converted work order: open the requested RFQ in the builder.
  useEffect(() => {
    if (!openId || loading) return;
    const r = rows.find((x) => x.id === openId);
    if (r) { openRFQ(r); onOpened && onOpened(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, loading, rows]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  function newRFQ() { setEditingId(null); setForm(EMPTY); setStatus("draft"); setView("builder"); }
  function openRFQ(r) {
    setEditingId(r.id);
    setForm({ ...EMPTY, ...withVariants(r.data || {}), project_ref: r.project_ref || r.data?.project_ref || "", _rfq_number: r.rfq_number, _created_at: r.created_at });
    setStatus(r.status || "draft");
    setView("builder");
  }

  // Build the RFQ object the PDF lib expects (uses current form state).
  function currentRFQ() {
    return { rfq_number: form._rfq_number || null, project_ref: form.project_ref, created_at: form._created_at || new Date().toISOString(), data: form };
  }

  // Fetch attachment bytes from storage for merging.
  async function fetchAttachmentBytes() {
    const out = [];
    for (const a of form.attachments || []) {
      try {
        const { data, error } = await supabase.storage.from("rfq-files").download(a.path);
        if (error || !data) continue;
        out.push({ name: a.name, bytes: new Uint8Array(await data.arrayBuffer()) });
      } catch { /* skip */ }
    }
    return out;
  }

  const [busyPdf, setBusyPdf] = useState("");
  async function genOutbound(vendor) {
    if (!editingId) { toast.error("Save the RFQ first."); return; }
    setBusyPdf(vendor);
    try {
      const atts = await fetchAttachmentBytes();
      await downloadOutboundRFQ(currentRFQ(), vendor, atts);
      // Generating the outbound doc advances draft -> issued.
      if (status === "draft") { setStatus("issued"); await supabase.from("rfqs").update({ status: "issued" }).eq("id", editingId); load(); }
    } catch (e) { toast.error("Couldn't build the RFQ PDF."); }
    setBusyPdf("");
  }
  async function genInternal() {
    if (!editingId) { toast.error("Save the RFQ first."); return; }
    setBusyPdf("__internal");
    try { await downloadInternalSpec(currentRFQ()); }
    catch { toast.error("Couldn't build the internal spec."); }
    setBusyPdf("");
  }

  // Delete an RFQ + its attachments from storage. Used from list and builder.
  async function deleteRFQ(r) {
    const wasConverted = r.status === "converted";
    const msg = wasConverted
      ? `Delete RFQ ${r.rfq_number || ""}? Its project and work orders will remain — only this RFQ is removed. This can't be undone.`
      : `Delete RFQ ${r.rfq_number || ""}? This can't be undone.`;
    if (!window.confirm(msg)) return;
    const paths = (r.data?.attachments || []).map((a) => a.path).filter(Boolean);
    if (paths.length) { try { await supabase.storage.from("rfq-files").remove(paths); } catch { /* best effort */ } }
    const { error } = await supabase.from("rfqs").delete().eq("id", r.id);
    if (error) { toast.error("Couldn't delete the RFQ."); return; }
    toast.success("RFQ deleted.");
    if (editingId === r.id) { setView("list"); setEditingId(null); }
    load();
  }

  // Overage math
  // Per-variant overage + cross-variant totals.
  const variantTotals = (v) => {
    const over = 1 + (Number(v.overage) || 0) / 100;
    return { sticks: (Number(v.qty) || 0) * over, sachets: (Number(v.sachets) || 0) * over };
  };
  const grand = (form.variants || []).reduce((a, v) => {
    const t = variantTotals(v);
    return { sticks: a.sticks + t.sticks, sachets: a.sachets + t.sachets };
  }, { sticks: 0, sachets: 0 });

  const setVariant = (i, patch) => setForm((f) => { const a = [...f.variants]; a[i] = { ...a[i], ...patch }; return { ...f, variants: a }; });
  const addVariant = () => setForm((f) => ({ ...f, variants: [...f.variants, { size: "", qty: "", sachets: "", overage: "8" }] }));
  const removeVariant = (i) => setForm((f) => ({ ...f, variants: f.variants.length > 1 ? f.variants.filter((_, x) => x !== i) : f.variants }));

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
      status,
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

  // --- Convert: RFQ -> project + label work order ----------------------------
  const [converting, setConverting] = useState("");

  // Persist a patch into the RFQ's data blob + top-level fields, then reflect it.
  async function patchRFQ(patch) {
    const nextData = { ...form, ...patch.data };
    const { error } = await supabase.from("rfqs")
      .update({ data: nextData, status: patch.status ?? status })
      .eq("id", editingId);
    if (error) throw error;
    setForm(nextData);
    if (patch.status) setStatus(patch.status);
  }

  // Create a project from this RFQ (name = project ref) + a seed task to hang
  // work orders on. Stores project_id + seed task id back on the RFQ.
  async function createProject() {
    if (!editingId) { toast.error("Save the RFQ first."); return; }
    if (form._project_id) { toast.error("A project was already created for this RFQ."); return; }
    setConverting("project");
    try {
      const { data: proj, error: pe } = await supabase.from("projects")
        .insert({ name: form.project_ref || `RFQ ${form._rfq_number || ""}`.trim(), sort_order: 0 })
        .select("id,name").single();
      if (pe) throw pe;
      const { data: task, error: te } = await supabase.from("tasks")
        .insert({ project_id: proj.id, title: `RFQ ${form._rfq_number || ""} — production`.trim(), status: "To do", sort_order: 0, owners: [userEmail].filter(Boolean) })
        .select("id").single();
      if (te) throw te;
      await patchRFQ({ data: { _project_id: proj.id, _project_name: proj.name, _seed_task_id: task.id }, status: "converted" });
      toast.success(`Project created — ${proj.name}`);
      load();
    } catch (e) { console.error("[rfq createProject]", e); toast.error("Project: " + (e?.message || e)); }
    setConverting("");
  }

  // Create a standard label work order (native row in the Label Work Orders
  // table), pre-filled from the RFQ, linked to the project via work_order_links.
  async function createLabelOrder() {
    if (!editingId) { toast.error("Save the RFQ first."); return; }
    if (form._job_id) { toast.error("A label work order was already created for this RFQ."); return; }
    setConverting("label");
    try {
      // Ensure there's a project + task to link under (create on the fly if not).
      let projectId = form._project_id, taskId = form._seed_task_id, projName = form._project_name;
      if (!projectId || !taskId) {
        const { data: proj, error: pe } = await supabase.from("projects")
          .insert({ name: form.project_ref || `RFQ ${form._rfq_number || ""}`.trim(), sort_order: 0 }).select("id,name").single();
        if (pe) throw pe;
        const { data: task, error: te } = await supabase.from("tasks")
          .insert({ project_id: proj.id, title: `RFQ ${form._rfq_number || ""} — production`.trim(), status: "To do", sort_order: 0, owners: [userEmail].filter(Boolean) }).select("id").single();
        if (te) throw te;
        projectId = proj.id; taskId = task.id; projName = proj.name;
      }

      const vendor = (form.vendors || []).filter(Boolean)[0] || "";
      const baseDesc = [
        `${form.skus || "—"} SKU(s) · ${form.components_per_sku || "—"}`,
        `${form.sticks_per_sachet || "—"} sticks/sachet`,
        [form.sachet_stock, form.lamination, form.food_grade, form.color_system].filter(Boolean).join(" · "),
        form.notes ? `Notes: ${form.notes}` : "",
      ].filter(Boolean).join("\n");

      // One work order per size (each variant = its own production run).
      const jobIds = [];
      for (const v of form.variants || []) {
        const over = 1 + (Number(v.overage) || 0) / 100;
        const qty = Math.round((Number(v.qty) || 0) * over);
        const sizeLabel = v.size ? ` — ${v.size}` : "";
        const desc = `Size: ${v.size || "—"}\n${baseDesc}` + (vendor ? `\nVendor (RFQ): ${vendor}` : "");

        const { data: job, error: je } = await supabase.from("jobs").insert({
          job_title: `${form.project_ref || `RFQ ${form._rfq_number || ""}`.trim()}${sizeLabel}`,
          brand: form.brand || null,
          print_qty: qty,
          printing_facility: null,
          description: desc,
          status: "Not Submitted",
          rfq_id: editingId,
        }).select("id").single();
        if (je) throw je;
        jobIds.push(job.id);

        const { error: le } = await supabase.from("work_order_links")
          .insert({ order_id: job.id, order_kind: "label", task_id: taskId, created_by: userEmail });
        if (le) throw le;
      }

      await patchRFQ({ data: { _job_id: jobIds[0], _job_ids: jobIds, _project_id: projectId, _project_name: projName, _seed_task_id: taskId }, status: "converted" });
      toast.success(jobIds.length > 1 ? `${jobIds.length} label work orders created — one per size.` : "Label work order created — find it on Label Work Orders.");
      load();
    } catch (e) { console.error("[rfq createLabelOrder]", e); toast.error("Work order: " + (e?.message || e)); }
    setConverting("");
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
                <tr><th>RFQ #</th><th>Project</th><th>Category</th><th>Status</th><th className="num">Vendors</th><th>Created</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="row" onClick={() => openRFQ(r)}>
                    <td className="cell-title">{r.rfq_number || "—"}</td>
                    <td>{r.project_ref || "—"}</td>
                    <td>{(r.category || "").replace(/_/g, " ")}</td>
                    <td><span className={`pill pill-rfq-${(r.status || "draft")}`}>{r.status || "draft"}</span></td>
                    <td className="num">{(r.data?.vendors || []).filter(Boolean).length}</td>
                    <td>{fmtDate(r.created_at)}</td>
                    <td className="rfq-row-del" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="rfq-del-btn" onClick={() => deleteRFQ(r)} aria-label={`Delete RFQ ${r.rfq_number || ""}`}>Delete</button>
                    </td>
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
    <div className="page-card rfq-page">
      <div className="page-head">
        <div className="page-head-left">
          <h1 className="page-title">{editingId ? "Edit RFQ" : "New request for quotation"}</h1>
          <span className="page-meta">Stick packs</span>
        </div>
        <div className="page-head-right">
          <select className="rfq-status-sel" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="RFQ status">
            <option value="draft">Draft</option>
            <option value="issued">Issued</option>
            <option value="converted">Converted</option>
          </select>
          {editingId && (
            <button className="btn-ghost rfq-del-btn" onClick={() => deleteRFQ({ id: editingId, rfq_number: form.project_ref, status, data: form })}>Delete</button>
          )}
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
              <option value="">Select…</option><option>Packaging only — no filling</option><option>Packaging + fill</option>
            </select>
          </label>
        </div>

        <div className="pm-section-label">Job &amp; product <span className="field-hint">— shared across all sizes</span></div>
        <div className="field-row">
          <label className="field"><span>Project reference</span><input value={form.project_ref} onChange={(e) => set("project_ref", e.target.value)} /></label>
          <label className="field"><span>Product / flavor</span><input value={form.product} onChange={(e) => set("product", e.target.value)} /></label>
        </div>
        <div className="field-row">
          <label className="field"><span>Finished SKUs</span><input value={form.skus} onChange={(e) => set("skus", e.target.value)} /></label>
          <label className="field"><span>Components per SKU</span><input value={form.components_per_sku} onChange={(e) => set("components_per_sku", e.target.value)} /></label>
        </div>
        <div className="field-row">
          <label className="field"><span>Sticks per sachet</span><input value={form.sticks_per_sachet} onChange={(e) => set("sticks_per_sachet", e.target.value)} /></label>
          <label className="field" style={{ visibility: "hidden" }}><span>.</span><input readOnly /></label>
        </div>

        <div className="pm-section-label">Variants <span className="field-hint">— same product, one row per size</span></div>
        <p className="muted small" style={{ margin: "0 0 4px" }}>Each size is quoted separately by the supplier. Materials, print, and vendors below are shared.</p>
        {(form.variants || []).map((v, i) => {
          const t = variantTotals(v);
          return (
            <div className="rfq-variant" key={i}>
              <div className="rfq-variant-top">
                <span className="rfq-variant-name"><span className="rfq-vbadge">Size {i + 1}</span> {v.size || "unnamed size"}</span>
                <button type="button" className="rfq-x" onClick={() => removeVariant(i)} aria-label="Remove size" disabled={form.variants.length === 1}>×</button>
              </div>
              <div className="rfq-variant-grid">
                <label className="field"><span>Size / label</span><input value={v.size} onChange={(e) => setVariant(i, { size: e.target.value })} placeholder="e.g. 60mm" /></label>
                <label className="field"><span>Quantity</span><input type="number" value={v.qty} onChange={(e) => setVariant(i, { qty: e.target.value })} /></label>
                <label className="field"><span>Sachets</span><input type="number" value={v.sachets} onChange={(e) => setVariant(i, { sachets: e.target.value })} /></label>
                <label className="field"><span>Overage %</span><input type="number" value={v.overage} onChange={(e) => setVariant(i, { overage: e.target.value })} /></label>
              </div>
              <div className="rfq-calc"><span>With overage</span><b>{fmtInt(t.sticks)} sticks · {fmtInt(t.sachets)} sachets</b></div>
            </div>
          );
        })}
        <button type="button" className="btn-ghost rfq-addvend" onClick={addVariant}>+ Add another size</button>
        {form.variants.length > 1 && (
          <div className="rfq-calc rfq-grand"><span>Total across sizes</span><b>{fmtInt(grand.sticks)} sticks · {fmtInt(grand.sachets)} sachets · {form.variants.length} sizes</b></div>
        )}

        <div className="pm-section-label">Materials &amp; print <span className="field-hint">— shared across all sizes</span></div>
        <div className="field-row">
          <label className="field"><span>Sachet stock</span><select value={form.sachet_stock} onChange={(e) => set("sachet_stock", e.target.value)}><option value="">Select…</option><option>Premade</option><option>Roll stock</option></select></label>
          <label className="field"><span>Lamination</span><select value={form.lamination} onChange={(e) => set("lamination", e.target.value)}><option value="">Select…</option><option>Matte</option><option>Gloss</option></select></label>
        </div>
        <div className="field-row">
          <label className="field"><span>Food grade</span><select value={form.food_grade} onChange={(e) => set("food_grade", e.target.value)}><option value="">Select…</option><option>Required</option><option>Not required</option></select></label>
          <label className="field"><span>Color system</span><select value={form.color_system} onChange={(e) => set("color_system", e.target.value)}><option value="">Select…</option><option>Process CMYK</option><option>Pantone / spot</option></select></label>
        </div>
        <div className="field-row">
          <label className="field"><span>Color match</span><select value={form.color_match} onChange={(e) => set("color_match", e.target.value)}><option value="">Select…</option><option>Must match — no exceptions</option><option>Reference only</option></select></label>
          <label className="field"><span>Press technology</span><select value={form.press_tech} onChange={(e) => set("press_tech", e.target.value)}><option value="">Select…</option>{PRESS_OPTS.map((o) => <option key={o}>{o}</option>)}</select></label>
        </div>

        <div className="pm-section-label">Commercial &amp; status</div>
        <div className="field-row">
          <label className="field"><span>Artwork status</span><select value={form.artwork_status} onChange={(e) => set("artwork_status", e.target.value)}><option value="">Select…</option><option>For quoting only — proofing to follow</option><option>Final / production-ready</option></select></label>
          <label className="field"><span>Freight</span><select value={form.freight} onChange={(e) => set("freight", e.target.value)}><option value="">Select…</option><option>Handled by NutraPack</option><option>Supplier delivers</option></select></label>
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

        <div className="pm-section-label">Convert <span className="field-hint">— turn this RFQ into a project and a label work order</span></div>
        {!editingId ? (
          <p className="muted small">Save the RFQ first to convert it.</p>
        ) : (
          <div className="rfq-docs">
            <div className="rfq-docs-row">
              <span className="rfq-docs-label">
                Project
                {form._project_id && <span className="rfq-linked"> · {form._project_name || "created"}</span>}
              </span>
              <div className="rfq-docs-btns">
                <button type="button" className="btn-ghost" onClick={createProject} disabled={converting === "project" || !!form._project_id}>
                  {converting === "project" ? "Creating…" : form._project_id ? "Created" : "Create project"}
                </button>
              </div>
            </div>
            <div className="rfq-docs-row">
              <span className="rfq-docs-label">
                Label work order
                {form._job_id && <span className="rfq-linked"> · created</span>}
              </span>
              <div className="rfq-docs-btns">
                <button type="button" className="btn-accent" onClick={createLabelOrder} disabled={converting === "label" || !!form._job_id}>
                  {converting === "label" ? "Creating…" : form._job_id ? "Created" : "Create label work order"}
                </button>
              </div>
            </div>
            <p className="muted small">Creates a standard order on Label Work Orders (looks like any other) and links it to the project. Marks this RFQ “converted”.</p>
          </div>
        )}

        <div className="pm-section-label">Documents <span className="field-hint">— generate the PDF to send (attachments merged in)</span></div>
        {!editingId ? (
          <p className="muted small">Save the RFQ first to generate its documents.</p>
        ) : (
          <div className="rfq-docs">
            <div className="rfq-docs-row">
              <span className="rfq-docs-label">Outbound RFQ</span>
              <div className="rfq-docs-btns">
                {(form.vendors || []).filter(Boolean).length === 0 ? (
                  <span className="muted small">Add a vendor above to generate the RFQ.</span>
                ) : (
                  form.vendors.filter(Boolean).map((v) => (
                    <button key={v} type="button" className="btn-ghost" onClick={() => genOutbound(v)} disabled={busyPdf === v}>
                      {busyPdf === v ? "Building…" : `RFQ → ${v}`}
                    </button>
                  ))
                )}
              </div>
            </div>
            <div className="rfq-docs-row">
              <span className="rfq-docs-label">Internal spec <span className="field-hint">(not for suppliers)</span></span>
              <div className="rfq-docs-btns">
                <button type="button" className="btn-ghost rfq-del-btn" onClick={genInternal} disabled={busyPdf === "__internal"}>
                  {busyPdf === "__internal" ? "Building…" : "Download internal spec"}
                </button>
              </div>
            </div>
          </div>
        )}

        <p className="muted small rfq-note">Generating an outbound RFQ marks this as “issued” and merges any attachments after the RFQ pages.</p>
      </div>
    </div>
  );
}
