import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { STATUSES, FACILITIES } from "../supabaseClient";
import DatePicker from "./DatePicker";

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
    if (days <= WARN_DAYS && days >= 0) return `⚠️ Proof files will be auto-deleted in ${days} day${days !== 1 ? "s" : ""}.`;
    if (days < 0) return "⚠️ Proof files are scheduled for deletion.";
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
                <input list="customer-list" placeholder="Type or pick a customer"
                  value={form.brand} onChange={(e) => set("brand", e.target.value)} />
                <datalist id="customer-list">
                  {customers.map((c) => <option key={c} value={c} />)}
                </datalist>
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
                <select value={form.printing_facility} onChange={(e) => set("printing_facility", e.target.value)}>
                  <option value="">— Select facility —</option>
                  {FACILITIES.map((f) => <option key={f} value={f}>{f}</option>)}
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
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email || ""));
  }, []);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("job_files").select("*").eq("job_id", jobId).order("created_at", { ascending: false });
    setFiles(data ?? []);
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  async function upload(e) {
    const picked = Array.from(e.target.files || []);
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
    e.target.value = "";
    setUploading(false);
    load();
  }

  async function download(file) {
    const { data, error } = await supabase.storage.from("job-files").download(file.storage_path);
    if (error) { alert("Download failed: " + error.message); return; }
    const url = URL.createObjectURL(data);
    const a = document.createElement("a"); a.href = url; a.download = file.name; a.click();
    URL.revokeObjectURL(url);
  }

  async function remove(file) {
    if (!confirm(`Delete "${file.name}"? This cannot be undone.`)) return;
    await supabase.storage.from("job-files").remove([file.storage_path]);
    await supabase.from("job_files").delete().eq("id", file.id);
    load();
  }

  return (
    <div className="modal-body files-panel">
      <p className="panel-note">Upload proof files for this job. Proofs are automatically deleted 30 days after the job is marked Delivered.</p>
      <label className="upload-zone">
        <input type="file" multiple onChange={upload} disabled={uploading} style={{ display: "none" }} />
        <div className="upload-inner">
          <span className="upload-icon">↑</span>
          <span>{uploading ? "Uploading…" : "Click to upload proof files"}</span>
          <span className="muted small">PDF, AI, images — any format</span>
        </div>
      </label>
      {files.length === 0 ? (
        <p className="muted small" style={{ textAlign: "center", padding: "16px 0" }}>No proof files uploaded yet.</p>
      ) : (
        <div className="file-list">
          {files.map((f) => (
            <div className="file-row" key={f.id}>
              <span className="file-icon">{fileIcon(f.mime_type)}</span>
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

  async function removeLink(id) {
    if (isStaged) { setStaged(staged.filter((l) => l.id !== id)); return; }
    if (!confirm("Remove this artwork link?")) return;
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
              <span className="file-icon">🔗</span>
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
    </div>
  );
}

function fileIcon(mime) {
  if (!mime) return "📄";
  if (mime.includes("pdf")) return "📕";
  if (mime.includes("image")) return "🖼️";
  return "📄";
}
function fmtSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
