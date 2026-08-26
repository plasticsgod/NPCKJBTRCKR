import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { STATUSES, FACILITIES } from "../supabaseClient";
import DatePicker from "./DatePicker";
import ConfirmModal from "./ConfirmModal";
import { toast } from "./Toaster";
import CustomerCombo from "./CustomerCombo";

const EMPTY = {
  job_title: "",
  brand: "",
  description: "",
  print_qty: 0,
  cost: "",
  revenue: "",
  deposit: "Not Applicable",
  status: "Not Submitted",
  ship_to: "",
  po_number: "",
  printing_facility: "",
  facility: "",
  shipping_address: "",
  sttark_order_id: "",
  files_delete_after: null,
};

const DELETE_DAYS = 30;
const WARN_DAYS   = 3;

export default function JobModal({ job, customers = [], onSave, onClose }) {
  const isNew = !job.id;
  const [tab, setTab] = useState("details");
  const [form, setForm] = useState({ ...EMPTY, ...job });
  const [stagedArtwork, setStagedArtwork] = useState([]); // links added before the job exists

  // Printing facilities come from the Console-managed table. Seed with the
  // legacy hardcoded list so the dropdown is never empty (and still works if
  // the table read fails or the migration hasn't run), then replace with the
  // live rows. Names are the stored value, so "Sttark" logic below is unaffected.
  const [facilities, setFacilities] = useState(() => FACILITIES.map((name) => ({ name, active: true })));
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from("printing_facilities")
        .select("name,active")
        .order("name");
      if (!alive) return;
      if (!error && Array.isArray(data) && data.length) setFacilities(data);
    })();
    return () => { alive = false; };
  }, []);

  // --- Project (task link) tab: mirrors the plastic order modal, kind="label" ---
  const [linkProjects, setLinkProjects] = useState([]);
  const [linkTasks, setLinkTasks] = useState([]);
  const [links, setLinks] = useState([]);
  const [pickProjectId, setPickProjectId] = useState(null);
  const [changingProject, setChangingProject] = useState(false);
  const [linkUser, setLinkUser] = useState("");

  useEffect(() => {
    supabase.from("projects").select("id,name").order("name").then(({ data }) => setLinkProjects(data || []));
    supabase.from("tasks").select("id,project_id,title").then(({ data }) => setLinkTasks(data || []));
    supabase.auth.getUser().then(({ data }) => setLinkUser(data.user?.email || ""));
  }, []);

  const loadLinks = useCallback(async () => {
    if (!job.id) { setLinks([]); return; }
    const { data } = await supabase.from("work_order_links")
      .select("id,task_id").eq("order_id", job.id).eq("order_kind", "label");
    setLinks(data || []);
  }, [job.id]);
  useEffect(() => { loadLinks(); }, [loadLinks]);

  const linkBrand = (form.brand || "").trim().toLowerCase();
  const matchedProject = linkBrand
    ? linkProjects.find((p) => (p.name || "").trim().toLowerCase() === linkBrand) || null
    : null;
  const linkedTaskIds = new Set(links.map((l) => l.task_id));
  const linkedProjectIds = new Set(linkTasks.filter((t) => linkedTaskIds.has(t.id)).map((t) => t.project_id));
  const activeProjectId = pickProjectId
    || (linkedProjectIds.size ? [...linkedProjectIds][0] : null)
    || matchedProject?.id || null;
  const activeLinkProject = linkProjects.find((p) => p.id === activeProjectId) || null;
  const projectTasks = linkTasks.filter((t) => t.project_id === activeProjectId && !linkedTaskIds.has(t.id));
  const linkTitleOf = (id) => linkTasks.find((t) => t.id === id)?.title || "Task";
  const linkProjectOf = (taskId) => {
    const t = linkTasks.find((x) => x.id === taskId);
    return t ? (linkProjects.find((p) => p.id === t.project_id)?.name || "") : "";
  };
  async function addTaskLink(taskId) {
    if (!taskId) return;
    const { error } = await supabase.from("work_order_links").insert({
      order_id: job.id, order_kind: "label", task_id: taskId, created_by: linkUser,
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

  function set(key, value) {
    if (key === "status") {
      if (value === "Delivered") {
        const d = new Date();
        d.setDate(d.getDate() + DELETE_DAYS);
        setForm((f) => ({ ...f, status: value, files_delete_after: d.toISOString().slice(0, 10) }));
      } else {
        setForm((f) => ({ ...f, status: value, files_delete_after: null }));
      }
    } else {
      setForm((f) => ({ ...f, [key]: value }));
    }
  }

  function submit(e) {
    e.preventDefault();
    if (!form.job_title.trim()) return;
    onSave({
      ...form,
      print_qty: Number(form.print_qty) || 0,
      cost: form.cost === "" || form.cost == null ? null : Number(form.cost) || 0,
      revenue: form.revenue === "" || form.revenue == null ? null : Number(form.revenue) || 0,
      __stagedArtwork: isNew ? stagedArtwork : [],
    });
  }

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const deleteWarning = (() => {
    if (!form.files_delete_after) return null;
    const d = new Date(form.files_delete_after);
    const days = Math.ceil((d - new Date()) / 86400000);
    if (days <= WARN_DAYS && days >= 0) return `Proof files will be auto-deleted in ${days} day${days !== 1 ? "s" : ""}.`;
    if (days < 0) return "Proof files are scheduled for deletion.";
    return null;
  })();

  return (
    <div className="overlay">
      <form className="modal modal-tabs" onSubmit={submit}>
        <div className="modal-head">
          <h2>{isNew ? "New Job" : "Edit Job"}</h2>
          <div className="modal-tab-bar">
            <button type="button" className={tab === "details" ? "mtab on" : "mtab"} onClick={() => setTab("details")}>Details</button>
            {!isNew && <button type="button" className={tab === "proofs" ? "mtab on" : "mtab"} onClick={() => setTab("proofs")}>Proofs</button>}
            <button type="button" className={tab === "artwork" ? "mtab on" : "mtab"} onClick={() => setTab("artwork")}>Artwork</button>
            {!isNew && <button type="button" className={tab === "project" ? "mtab on" : "mtab"} onClick={() => setTab("project")}>Project{links.length ? ` (${links.length})` : ""}</button>}
          </div>
          <button type="button" className="link" onClick={onClose}>Close</button>
        </div>

        {tab === "details" && (
          <div className="modal-body">
            {deleteWarning && <p className="delete-warning">{deleteWarning}</p>}
            <label className="field">
              <span>Job Title</span>
              <input value={form.job_title} onChange={(e) => set("job_title", e.target.value)} required autoFocus />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Customer</span>
                <CustomerCombo value={form.brand} onChange={(v) => set("brand", v)} customers={customers} />
              </label>
              <label className="field">
                <span>Print Qty</span>
                <input type="number" min="0" value={form.print_qty}
                  onChange={(e) => set("print_qty", e.target.value)} />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Total Cost <span className="field-hint">— what we paid (brokering)</span></span>
                <input type="number" min="0" step="0.01" placeholder="0.00"
                  value={form.cost} onChange={(e) => set("cost", e.target.value)} />
              </label>
              <label className="field">
                <span>Client Charge <span className="field-hint">— what we bill the client</span></span>
                <input type="number" min="0" step="0.01" placeholder="0.00"
                  value={form.revenue} onChange={(e) => set("revenue", e.target.value)} />
              </label>
            </div>
            {(form.cost !== "" || form.revenue !== "") && (
              <p className="profit-hint">
                Profit: <b>${((Number(form.revenue) || 0) - (Number(form.cost) || 0)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
              </p>
            )}
            <label className="field">
              <span>Deposit</span>
              <select value={form.deposit || "Not Applicable"} onChange={(e) => set("deposit", e.target.value)}>
                <option value="Not Applicable">Not Applicable</option>
                <option value="Paid">Paid</option>
                <option value="Owed">Owed</option>
              </select>
            </label>
            <div className="field-row">
              <label className="field">
                <span>Status</span>
                <select value={form.status} onChange={(e) => set("status", e.target.value)}>
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Printing Facility</span>
                <select value={form.printing_facility} onChange={(e) => {
                  const v = e.target.value;
                  // Switching away from Sttark drops the Sttark link so its live
                  // status sync stops overriding this order.
                  setForm((f) => ({ ...f, printing_facility: v, ...(v !== "Sttark" ? { sttark_order_id: "" } : {}) }));
                }}>
                  <option value="">— Select facility —</option>
                  {(() => {
                    const activeNames = facilities.filter((f) => f.active).map((f) => f.name);
                    // Keep the order's current facility even if it was since deactivated,
                    // so reopening an old order never silently blanks it.
                    const names = form.printing_facility && !activeNames.includes(form.printing_facility)
                      ? [...activeNames, form.printing_facility]
                      : activeNames;
                    return names.map((name) => (
                      <option key={name} value={name}>
                        {name}{!activeNames.includes(name) ? " (inactive)" : ""}
                      </option>
                    ));
                  })()}
                </select>
              </label>
            </div>
            {form.printing_facility === "Sttark" && (
              <label className="field">
                <span>Sttark Order ID <span className="field-hint">— links live Sttark status</span></span>
                <input value={form.sttark_order_id || ""} placeholder="e.g. 987971"
                  onChange={(e) => set("sttark_order_id", e.target.value.trim())} />
              </label>
            )}
            <label className="field">
              <span>Description</span>
              <textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} />
            </label>
            <div className="field-row">
              <label className="field">
                <span>PO Number</span>
                <input value={form.po_number} onChange={(e) => set("po_number", e.target.value)} />
              </label>
              <label className="field">
                <span>Ship To</span>
                <input value={form.ship_to} onChange={(e) => set("ship_to", e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>Shipping Address</span>
              <textarea rows={2} value={form.shipping_address} onChange={(e) => set("shipping_address", e.target.value)} />
            </label>
            {form.files_delete_after && (
              <label className="field">
                <span>Proof files auto-delete date <span className="field-hint">— change to extend</span></span>
                <DatePicker value={form.files_delete_after || ""} onChange={(v) => set("files_delete_after", v || null)} />
              </label>
            )}
          </div>
        )}

        {tab === "proofs" && <ProofsPanel jobId={job.id} jobTitle={form.job_title} customer={form.brand} />}
        {tab === "artwork" && <ArtworkPanel jobId={job.id} staged={stagedArtwork} setStaged={setStagedArtwork} />}

        {tab === "project" && (
          <div className="modal-body">
            <div className="link-project">
              <span className="link-project-label">Project</span>
              {activeLinkProject ? (
                <span className="link-project-name">
                  {activeLinkProject.name}
                  {matchedProject && activeLinkProject.id === matchedProject.id && !linkedProjectIds.size && (
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

            {(changingProject || !activeLinkProject) && (
              <label className="field link-project-picker">
                <span>Pick a project to browse its tasks</span>
                <select value={activeProjectId || ""} onChange={(e) => setPickProjectId(e.target.value || null)}>
                  <option value="">— Select a project —</option>
                  {linkProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
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
                    <span className="link-name">{linkTitleOf(l.task_id)}</span>
                    <span className="link-proj muted">{linkProjectOf(l.task_id)}</span>
                    <button type="button" className="link danger" onClick={() => removeTaskLink(l.id)}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="muted files-note">Linked tasks show this order on the project’s Work orders tab.</div>
          </div>
        )}

        <div className="modal-foot">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          {tab === "details" && <button type="submit" className="btn-accent">{isNew ? "Create Job" : "Save Changes"}</button>}
        </div>
      </form>
    </div>
  );
}

// ---- Proofs panel (file uploads with branded cover sheet) -----------------
function ProofsPanel({ jobId, jobTitle, customer }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [confirmState, setConfirmState] = useState(null);
  function remove(file) {
    setConfirmState({ title: "Delete file?", message: `Delete "${file.name}"? This cannot be undone.`, confirmLabel: "Delete", onConfirm: () => doRemove(file) });
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email || ""));
  }, []);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("job_files").select("*").eq("job_id", jobId).order("created_at", { ascending: false });
    setFiles(data ?? []);
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  async function handleFiles(fileList) {
    const picked = Array.from(fileList || []);
    if (!picked.length) return;
    setUploading(true);

    // Lazy-import the cover generator so it only loads when needed.
    const { buildProofPDF, mergeCoverWithPDF } = await import("../lib/proofCover.js");
    const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

    for (const file of picked) {
      try {
        const coverBytes = await buildProofPDF({
          jobTitle: jobTitle, customer, uploadedBy: userEmail, date,
          fileName: file.name, logoUrl: "/images/favicon.png",
        });

        let finalBlob, finalName, finalMime;

        if (file.type === "application/pdf") {
          // Merge cover as page 1 of the proof PDF.
          const mergedBytes = await mergeCoverWithPDF(coverBytes, file);
          finalBlob = new Blob([mergedBytes], { type: "application/pdf" });
          finalName = file.name;
          finalMime = "application/pdf";
        } else {
          // Upload original file as-is, then upload cover as a companion PDF.
          const origPath = `${jobId}/${Date.now()}-${file.name}`;
          const { error: origErr } = await supabase.storage.from("job-files").upload(origPath, file);
          if (!origErr) {
            await supabase.from("job_files").insert({
              job_id: jobId, name: file.name, size: file.size,
              mime_type: file.type, storage_path: origPath, uploaded_by: userEmail,
            });
          }
          // Companion cover sheet PDF.
          finalBlob = new Blob([coverBytes], { type: "application/pdf" });
          finalName = "NutraPack-Proof-Cover-" + file.name.replace(/\.[^.]+$/, "") + ".pdf";
          finalMime = "application/pdf";
        }

        const path = `${jobId}/${Date.now()}-${finalName}`;
        const { error: upErr } = await supabase.storage.from("job-files").upload(path, finalBlob);
        if (upErr) { alert("Upload failed: " + upErr.message); continue; }
        await supabase.from("job_files").insert({
          job_id: jobId, name: finalName, size: finalBlob.size,
          mime_type: finalMime, storage_path: path, uploaded_by: userEmail,
        });
      } catch (err) {
        console.error("Proof cover error:", err);
        // Fall back to uploading the original file without a cover.
        const path = `${jobId}/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage.from("job-files").upload(path, file);
        if (!upErr) await supabase.from("job_files").insert({
          job_id: jobId, name: file.name, size: file.size,
          mime_type: file.type, storage_path: path, uploaded_by: userEmail,
        });
      }
    }
    setUploading(false);
    load();
  }

  function upload(e) { const fl = e.target.files; handleFiles(fl); e.target.value = ""; }
  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (uploading) return;
    handleFiles(e.dataTransfer.files);
  }

  async function download(file) {
    const { data, error } = await supabase.storage.from("job-files").download(file.storage_path);
    if (error) { alert("Download failed. Please try again."); return; }
    const url = URL.createObjectURL(data);
    const a = document.createElement("a"); a.href = url; a.download = file.name; a.click();
    URL.revokeObjectURL(url);
  }

  async function doRemove(file) {
    await supabase.storage.from("job-files").remove([file.storage_path]);
    await supabase.from("job_files").delete().eq("id", file.id);
    load();
  }

  return (
    <div className="modal-body files-panel">
      <p className="panel-note">Upload proof files for this job. Proofs are automatically deleted 30 days after the job is marked Delivered.</p>
      <label className={"upload-zone" + (dragOver ? " dragover" : "")}
        onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
        onDrop={onDrop}>
        <input type="file" multiple onChange={upload} disabled={uploading} style={{ display: "none" }} />
        <div className="upload-inner">
          <span className="upload-icon">↑</span>
          <span>{uploading ? "Uploading…" : dragOver ? "Drop files to upload" : "Click or drag files to upload"}</span>
          <span className="muted small">PDF, AI, images — any format</span>
        </div>
      </label>
      {files.length === 0 ? (
        <p className="muted small" style={{ textAlign: "center", padding: "16px 0" }}>No proof files uploaded yet.</p>
      ) : (
        <div className="file-list">
          {files.map((f) => (
            <div className="file-row" key={f.id}>
              <span className="file-icon"><Glyph kind={fileKind(f.mime_type)} /></span>
              <div className="file-info">
                <span className="file-name">{f.name}</span>
                <span className="file-meta">{fmtSize(f.size)} · {f.uploaded_by} · {fmtDate(f.created_at)}</span>
              </div>
              <button type="button" className="link" onClick={() => download(f)}>Download</button>
              <button type="button" className="link danger" onClick={() => remove(f)}>Delete</button>
            </div>
          ))}
        </div>
      )}
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}

// ---- Artwork panel (links only) --------------------------------------------
// Works in two modes: for an existing job it reads/writes job_artwork directly;
// for a new job (no jobId) it stages links in memory, and JobModal saves them
// once the job is created.
function ArtworkPanel({ jobId, staged, setStaged }) {
  const isStaged = !jobId;
  const [dbLinks, setDbLinks] = useState([]);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [confirmState, setConfirmState] = useState(null);
  function removeLink(id) {
    if (isStaged) { setStaged(staged.filter((l) => l.id !== id)); return; }
    setConfirmState({ title: "Remove link?", message: "Remove this artwork link?", confirmLabel: "Remove", onConfirm: () => doRemoveLink(id) });
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email || ""));
  }, []);

  const load = useCallback(async () => {
    if (isStaged) return;
    const { data } = await supabase
      .from("job_artwork").select("*").eq("job_id", jobId).order("created_at", { ascending: false });
    setDbLinks(data ?? []);
  }, [jobId, isStaged]);

  useEffect(() => { load(); }, [load]);

  const links = isStaged ? staged : dbLinks;

  async function addLink() {
    if (!url.trim()) return;
    if (isStaged) {
      setStaged([
        { id: crypto.randomUUID(), label: label.trim() || "Artwork link", url: url.trim(), added_by: userEmail, _staged: true },
        ...staged,
      ]);
    } else {
      await supabase.from("job_artwork").insert({
        job_id: jobId,
        label: label.trim() || "Artwork link",
        url: url.trim(),
        added_by: userEmail,
      });
      load();
    }
    setLabel(""); setUrl("");
  }

  async function doRemoveLink(id) {
    await supabase.from("job_artwork").delete().eq("id", id);
    load();
  }

  return (
    <div className="modal-body files-panel">
      <p className="panel-note">
        Add links to approved artwork files (Google Drive, Dropbox, etc.). Links are never auto-deleted.
        {isStaged && " These save automatically when you create the job."}
      </p>
      <div className="artwork-form">
        <label className="field">
          <span>Label</span>
          <input value={label} placeholder="e.g. Final approved artwork"
            onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="field">
          <span>URL</span>
          <input value={url} placeholder="https://drive.google.com/..."
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }} />
        </label>
        <button type="button" className="btn-accent" onClick={addLink} disabled={!url.trim()}>Add link</button>
      </div>
      {links.length === 0 ? (
        <p className="muted small" style={{ textAlign: "center", padding: "16px 0" }}>No artwork links added yet.</p>
      ) : (
        <div className="file-list">
          {links.map((l) => (
            <div className="file-row" key={l.id}>
              <span className="file-icon"><Glyph kind="link" /></span>
              <div className="file-info">
                <span className="file-name">{l.label}</span>
                <span className="file-meta">{l._staged ? "Pending — saves with the job" : `${l.added_by} · ${fmtDate(l.created_at)}`}</span>
              </div>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="link">Open</a>
              <button type="button" className="link danger" onClick={() => removeLink(l.id)}>Remove</button>
            </div>
          ))}
        </div>
      )}
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}

const GLYPH_PATHS = {
  link: "M9 15l6-6 M11 6l1-1a3.5 3.5 0 015 5l-1 1 M13 18l-1 1a3.5 3.5 0 01-5-5l1-1",
  image: "M4 5h16v14H4z M4 15l4-4 3 3 4-5 5 6",
  pdf: "M6 3h9l3 3v15H6z M14 3v4h4",
  file: "M6 3h9l3 3v15H6z M14 3v4h4",
};
function Glyph({ kind = "file" }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={GLYPH_PATHS[kind] || GLYPH_PATHS.file} />
    </svg>
  );
}
function fileKind(mime) {
  if (!mime) return "file";
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("image")) return "image";
  return "file";
}
function fmtSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
