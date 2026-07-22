import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import {
  MARGINS, PORTS, findItem, unitEconomics, setEconomics, unitsFromQty, money2,
} from "../lib/pricing";
import { toast } from "./Toaster";

const STATUSES = ["Submitted", "In Production", "Shipped", "Delivered"];
const UNITS = ["pallets", "containers", "tubs"];
const ORIGINS = ["India", "China"];
const ORIGIN_ID = { India: "india", China: "china" };

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
    if (error) { toast.error("Couldn't link task — " + error.message); return; }
    setChangingProject(false);
    toast.success("Task linked");
    loadLinks();
  }
  async function removeTaskLink(linkId) {
    const { error } = await supabase.from("work_order_links").delete().eq("id", linkId);
    if (error) { toast.error("Couldn't remove — " + error.message); return; }
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
        if (error) { toast.error("Upload failed — " + error.message); continue; }
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

  // Picker state — seeded from a saved snapshot if this order already has one.
  const snap = job.pricing || null;
  const [prod, setProd] = useState(snap?.product || "");
  const [marginIdx, setMarginIdx] = useState(() => {
    const i = snap ? MARGINS.findIndex((m) => m.lab === snap.margin) : 0;
    return i >= 0 ? i : 0;
  });
  const [portc, setPortc] = useState(snap?.portc ?? "");
  const [truck, setTruck] = useState(snap?.truck ?? "");

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Live pricing computation from the current version.
  const calc = useMemo(() => {
    if (!data || !prod) return null;
    const [kind, id] = prod.split(":");
    const item = kind === "set" ? data.tubs.find((t) => t.id === id) : findItem(data, id);
    if (!item) return null;
    const oid = ORIGIN_ID[form.origin];
    const pid = portIdByName(form.port);
    const freight = (oid && pid && data.freight?.[oid]?.[pid]) || 0;
    const ship = { freight, portc: num(portc), truck: num(truck) };
    let unitCost, unitCharge;
    if (kind === "set") {
      const e = setEconomics(data, item, ship, {});
      unitCost = e.landed; unitCharge = e.sells[marginIdx];
    } else {
      const e = unitEconomics(item, kind, ship, {});
      unitCost = e.landed; unitCharge = e.sells[marginIdx];
    }
    const mode = form.qty_unit === "tubs" ? "units" : form.qty_unit === "pallets" ? "pallets" : "containers";
    const units = unitsFromQty(item, mode, num(form.qty));
    const totalCost = units != null ? unitCost * units : null;
    const totalCharge = units != null ? unitCharge * units : null;
    return { kind, id, item, freight, lane: !!(oid && pid), unitCost, unitCharge, units, totalCost, totalCharge };
  }, [data, prod, marginIdx, portc, truck, form.origin, form.port, form.qty, form.qty_unit]);

  function applyPricing() {
    if (!calc || !version || calc.totalCost == null) {
      toast.error("Pick a product, lane, and quantity first.");
      return;
    }
    const snapshot = {
      version_id: version.id,
      version_label: version.label,
      version_date: version.version_date,
      product: prod,
      product_name: calc.item.name,
      kind: calc.kind,
      margin: MARGINS[marginIdx].lab,
      origin: form.origin,
      port: form.port,
      freight: calc.freight,
      portc: num(portc), truck: num(truck),
      units: calc.units,
      unit_cost: calc.unitCost,
      unit_charge: calc.unitCharge,
      total_cost: calc.totalCost,
      total_charge: calc.totalCharge,
    };
    setForm((f) => ({
      ...f,
      cost: round2(calc.totalCost),
      revenue: round2(calc.totalCharge),
      pricing: snapshot,
      pricing_version_id: version.id,
    }));
    toast.success("Pricing applied — cost & charge filled (still editable)");
  }

  function submit(e) {
    e.preventDefault();
    if (!form.job_title.trim()) { setTab("details"); return; }
    onSave({
      ...form,
      qty: num(form.qty),
      cost: form.cost === "" || form.cost == null ? null : round2(num(form.cost)),
      revenue: form.revenue === "" || form.revenue == null ? null : round2(num(form.revenue)),
    });
  }

  const profit = (num(form.revenue)) - (num(form.cost));

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

            <div className="field-row">
              <label className="field">
                <span>Customer</span>
                <input list="plastic-customer-list" placeholder="Type or pick a customer"
                  value={form.brand} onChange={(e) => set("brand", e.target.value)} />
                <datalist id="plastic-customer-list">
                  {customers.map((c) => <option key={c} value={c} />)}
                </datalist>
              </label>
              <label className="field">
                <span>Quantity</span>
                <div className="qty-input">
                  <input type="number" min="0" value={form.qty} onChange={(e) => set("qty", e.target.value)} />
                  <select value={form.qty_unit} onChange={(e) => set("qty_unit", e.target.value)}>
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </label>
            </div>

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
            {(form.cost !== "" || form.revenue !== "") && (
              <p className="profit-hint">
                Profit: <b>${profit.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
                {form.pricing && <span className="field-hint"> · auto-priced from {form.pricing.version_label || "a pricing version"} (editable)</span>}
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
              <span>Description</span>
              <textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} />
            </label>

            <div className="pm-section-label">Pricing</div>
            {!data ? (
              <p className="muted">Loading pricing…</p>
            ) : (
              <>
                <p className="field-hint" style={{ marginBottom: 4 }}>
                  Using <b>{version.label}</b>{version.version_date ? ` · ${version.version_date}` : ""}. Applying fills Cost &amp; Charge from this version and freezes them on the order.
                </p>

                <label className="field">
                  <span>Product</span>
                  <select value={prod} onChange={(e) => setProd(e.target.value)}>
                    <option value="">— Select a product —</option>
                    <optgroup label="Tubs">
                      {data.tubs.map((t) => <option key={"tub:" + t.id} value={"tub:" + t.id}>{t.name}</option>)}
                    </optgroup>
                    <optgroup label="Lids">
                      {data.lids.map((l) => <option key={"lid:" + l.id} value={"lid:" + l.id}>{l.name}</option>)}
                    </optgroup>
                    <optgroup label="Sets (tub + lid)">
                      {data.tubs.map((t) => <option key={"set:" + t.id} value={"set:" + t.id}>{t.name.replace("Tub", "Set")} + lid</option>)}
                    </optgroup>
                  </select>
                </label>

                <div className="field-row">
                  <label className="field">
                    <span>Margin</span>
                    <select value={marginIdx} onChange={(e) => setMarginIdx(Number(e.target.value))}>
                      {MARGINS.map((m, i) => <option key={m.lab} value={i}>{m.lab}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span>Lane <span className="field-hint">— set in Shipping</span></span>
                    <input value={form.origin && form.port ? `${form.origin} → ${form.port}` : "—"} readOnly />
                  </label>
                </div>

                <div className="field-row">
                  <label className="field">
                    <span>Port / Customs</span>
                    <input type="number" min="0" placeholder="0" value={portc} onChange={(e) => setPortc(e.target.value)} />
                  </label>
                  <label className="field">
                    <span>Trucking</span>
                    <input type="number" min="0" placeholder="0" value={truck} onChange={(e) => setTruck(e.target.value)} />
                  </label>
                </div>

                <div className="pricing-calc">
                  {!prod ? (
                    <p className="muted">Pick a product to see pricing.</p>
                  ) : !calc?.lane ? (
                    <p className="muted">Set Shipping From + Port in the Shipping tab to pull freight.</p>
                  ) : calc.units == null ? (
                    <p className="muted">This product has no per-pallet/container count — switch quantity to tubs, or enter cost manually.</p>
                  ) : (
                    <>
                      <div className="pc-row"><span>Freight (lane)</span><b>{money2(calc.freight)}</b></div>
                      <div className="pc-row"><span>Per unit · cost / charge</span><b>{money2(calc.unitCost)} / {money2(calc.unitCharge)}</b></div>
                      <div className="pc-row"><span>Units ({form.qty || 0} {form.qty_unit})</span><b>{calc.units.toLocaleString()}</b></div>
                      <div className="pc-row total"><span>Total cost / charge</span><b>{money2(calc.totalCost)} / {money2(calc.totalCharge)}</b></div>
                    </>
                  )}
                </div>

                <button type="button" className="btn-accent" onClick={applyPricing}
                  disabled={!calc || calc.totalCost == null}>
                  Apply to Cost &amp; Charge
                </button>
                {form.pricing && (
                  <p className="field-hint" style={{ marginTop: 8 }}>
                    Applied: {form.pricing.product_name} · {form.pricing.margin} margin · snapshot saved with this order.
                  </p>
                )}
              </>
            )}
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
