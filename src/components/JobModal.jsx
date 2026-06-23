import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { STATUSES, FACILITIES } from "../supabaseClient";

const EMPTY = {
  job_title: "",
  brand: "",
  description: "",
  print_qty: 0,
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

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    // Auto-set files_delete_after when status flips to Delivered.
    if (key === "status") {
      if (value === "Delivered") {
        const d = new Date();
        d.setDate(d.getDate() + DELETE_DAYS);
        setForm((f) => ({ ...f, status: value, files_delete_after: d.toISOString().slice(0, 10) }));
      } else {
        setForm((f) => ({ ...f, status: value, files_delete_after: null }));
      }
    }
  }

  function submit(e) {
    e.preventDefault();
    if (!form.job_title.trim()) return;
    onSave({ ...form, print_qty: Number(form.print_qty) || 0 });
  }

  // Close on Escape only.
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Deletion warning
  const deleteWarning = (() => {
    if (!form.files_delete_after) return null;
    const d = new Date(form.files_delete_after);
    const now = new Date();
    const days = Math.ceil((d - now) / 86400000);
    if (days <= WARN_DAYS && days >= 0) return `⚠️ Files will be auto-deleted in ${days} day${days !== 1 ? "s" : ""}.`;
    if (days < 0) return "⚠️ Files are scheduled for deletion.";
    return null;
  })();

  return (
    <div className="overlay">
      <form className="modal modal-tabs" onSubmit={submit}>
        <div className="modal-head">
          <h2>{isNew ? "New Job" : "Edit Job"}</h2>
          <div className="modal-tab-bar">
            <button type="button" className={tab === "details" ? "mtab on" : "mtab"} onClick={() => setTab("details")}>Details</button>
            {!isNew && <button type="button" className={tab === "files" ? "mtab on" : "mtab"} onClick={() => setTab("files")}>Files</button>}
          </div>
          <button type="button" className="link" onClick={onClose}>Close</button>
        </div>

        {tab === "details" ? (
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
              <textarea rows={3} value={form.description}
                onChange={(e) => set("description", e.target.value)} />
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
              <textarea rows={2} value={form.shipping_address}
                onChange={(e) => set("shipping_address", e.target.value)} />
            </label>

            {form.files_delete_after && (
              <label className="field">
                <span>Files auto-delete date <span className="field-hint">— change to extend</span></span>
                <input type="date" value={form.files_delete_after}
                  onChange={(e) => set("files_delete_after", e.target.value || null)} />
              </label>
            )}
          </div>
        ) : (
          <FilesPanel jobId={job.id} />
        )}

        <div className="modal-foot">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-accent">{isNew ? "Create Job" : "Save Changes"}</button>
        </div>
      </form>
    </div>
  );
}

// ---- Files panel -----------------------------------------------------------
function FilesPanel({ jobId }) {
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
    for (const file of picked) {
      const path = `${jobId}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("job-files").upload(path, file);
      if (upErr) { alert("Upload failed: " + upErr.message); continue; }
      await supabase.from("job_files").insert({
        job_id: jobId, name: file.name, size: file.size,
        mime_type: file.type, storage_path: path, uploaded_by: userEmail,
      });
    }
    e.target.value = "";
    setUploading(false);
    load();
  }

  async function download(file) {
    const { data, error } = await supabase.storage.from("job-files").download(file.storage_path);
    if (error) { alert("Download failed: " + error.message); return; }
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url; a.download = file.name; a.click();
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
      <label className="upload-zone">
        <input type="file" multiple onChange={upload} disabled={uploading} style={{ display: "none" }} />
        <div className="upload-inner">
          <span className="upload-icon">↑</span>
          <span>{uploading ? "Uploading…" : "Click to upload files"}</span>
          <span className="muted small">AI, PDF, images — any format</span>
        </div>
      </label>

      {files.length === 0 ? (
        <p className="muted small" style={{ textAlign: "center", padding: "16px 0" }}>No files uploaded yet.</p>
      ) : (
        <div className="file-list">
          {files.map((f) => (
            <div className="file-row" key={f.id}>
              <span className="file-icon">{fileIcon(f.mime_type)}</span>
              <div className="file-info">
                <span className="file-name">{f.name}</span>
                <span className="file-meta">{fmtSize(f.size)} · {f.uploaded_by} · {fmtDate(f.created_at)}</span>
              </div>
              <button className="link" onClick={() => download(f)}>Download</button>
              <button className="link danger" onClick={() => remove(f)}>Delete</button>
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
  if (mime.includes("zip") || mime.includes("compressed")) return "🗜️";
  return "📄";
}
function fmtSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
