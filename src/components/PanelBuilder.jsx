import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../supabaseClient";
import { toast } from "./Toaster";

// Panel Builder — saved panels (Supplement Facts today, Nutrition Facts later).
// The builder is a self-contained tool (/public/tools/panel-builder.html) shown in
// a frame; it talks to this page with messages. This page saves every panel to
// `panel_projects` (autosave), keeps each imported spec file with its panel
// (storage bucket `panel-files`), and feeds the builder's project dropdown.

const FRAME_SRC = "/tools/panel-builder.html";
const BUCKET = "panel-files";
const AUTOSAVE_MS = 1200;

const firstName = (email) => (email ? String(email).split("@")[0].split(/[._]/)[0] : "");
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
function when(iso) {
  if (!iso) return "—";
  const d = new Date(iso), mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}
const newProjectId = () => Math.random().toString(36).slice(2, 9);
const safeName = (n) => String(n || "spec").replace(/[^\w.\-]+/g, "_").slice(-120);

export default function PanelBuilder({ userEmail }) {
  const [view, setView] = useState("list");           // list | editor
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmDel, setConfirmDel] = useState(null);

  // editor
  const [status, setStatus] = useState("idle");        // idle | unsaved | saving | saved | error
  const [savedAt, setSavedAt] = useState(null);
  const [hasRow, setHasRow] = useState(false);
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState([]);
  const [filesOpen, setFilesOpen] = useState(false);
  const frameRef = useRef(null);
  const rowIdRef = useRef(null);                       // database id of the open panel
  const pendingRef = useRef(null);                     // latest edits not yet saved
  const timerRef = useRef(null);
  const chainRef = useRef(Promise.resolve());          // saves/uploads run one at a time
  const flushWaiter = useRef(null);
  const modeRef = useRef(null);                        // {kind:'load',project} | {kind:'new'} | {kind:'import'}

  const post = (msg) => frameRef.current?.contentWindow?.postMessage(msg, window.location.origin);
  const queue = (fn) => { chainRef.current = chainRef.current.then(fn, fn); return chainRef.current; };

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("panel_projects")
      .select("id, name, customer, coman, panel_type, files, created_by, updated_by, updated_at")
      .order("updated_at", { ascending: false });
    if (error) { toast.error("Couldn't load panels."); setLoading(false); return; }
    setRows(data || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Keep the builder's project dropdown in sync with the saved list.
  const sendList = useCallback((list) => {
    post({ type: "np:list", items: (list || rows).map((r) => ({ id: r.id, name: r.name })), current: rowIdRef.current });
  }, [rows]);
  useEffect(() => { if (view === "editor") sendList(rows); }, [rows, view, sendList]);

  // ---- saving ---------------------------------------------------------------
  const doSave = useCallback(async () => {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    setStatus("saving");
    const fields = {
      name: (p.name || "").trim() || "Untitled product",
      customer: (p.client || "").trim() || null,
      coman: (p.coman || "").trim() || null,
      data: p,
      updated_by: userEmail,
    };
    let error;
    const isNew = !rowIdRef.current;
    if (!isNew) {
      ({ error } = await supabase.from("panel_projects").update(fields).eq("id", rowIdRef.current));
    } else {
      const res = await supabase.from("panel_projects")
        .insert({ ...fields, panel_type: "supplement", created_by: userEmail })
        .select("id").single();
      error = res.error;
      if (!error && res.data) { rowIdRef.current = res.data.id; setHasRow(true); }
    }
    if (error) {
      console.error("[panel save]", error);
      if (!pendingRef.current) pendingRef.current = p;
      setStatus("error");
      return;
    }
    setTitle(fields.name);
    setSavedAt(new Date().toISOString());
    setStatus(pendingRef.current ? "unsaved" : "saved");
    load();                                            // refresh list + builder dropdown
  }, [userEmail, load]);

  const saveNow = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    return queue(doSave);
  }, [doSave]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveSoon = useCallback(() => {
    setStatus("unsaved");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(saveNow, AUTOSAVE_MS);
  }, [saveNow]);

  // Get anything still being typed out of the builder, then save.
  const flushAndSave = useCallback(async () => {
    if (frameRef.current?.contentWindow) {
      await new Promise((resolve) => {
        flushWaiter.current = resolve;
        post({ type: "np:flush" });
        setTimeout(resolve, 800);
      });
      flushWaiter.current = null;
    }
    await saveNow();
  }, [saveNow]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- spec files -----------------------------------------------------------
  const storeSpecFile = useCallback((file, mode) => queue(async () => {
    const id = rowIdRef.current;
    if (!id || !file) return;
    const path = `${id}/${Date.now()}-${safeName(file.name)}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
    if (upErr) { console.error("[spec upload]", upErr); toast.error("Couldn't store the spec file."); return; }
    const { data: row } = await supabase.from("panel_projects").select("files").eq("id", id).single();
    const next = [
      { name: file.name, path, size: file.size, kind: mode === "update" ? "update" : "import", uploaded_by: userEmail, uploaded_at: new Date().toISOString() },
      ...((row && row.files) || []),
    ];
    const { error } = await supabase.from("panel_projects").update({ files: next }).eq("id", id);
    if (error) { toast.error("Couldn't record the spec file."); return; }
    if (rowIdRef.current === id) setFiles(next);
    toast.success(mode === "update" ? "Panel updated from the new spec." : "Panel created from the spec.");
  }), [userEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  async function downloadFile(f) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(f.path, 60);
    if (error || !data?.signedUrl) { toast.error("Couldn't open that file."); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  // ---- open / switch / new / duplicate -------------------------------------
  async function fetchRow(id) {
    const { data, error } = await supabase.from("panel_projects").select("*").eq("id", id).single();
    if (error || !data) { toast.error("Couldn't open that panel."); return null; }
    return data;
  }
  function showRow(row) {
    rowIdRef.current = row.id; pendingRef.current = null; setHasRow(true);
    setTitle(row.name); setFiles(row.files || []); setSavedAt(row.updated_at); setStatus("saved"); setFilesOpen(false);
    modeRef.current = { kind: "load", project: row.data, id: row.id };
  }

  async function openPanel(r) {                        // from the list
    const row = await fetchRow(r.id); if (!row) return;
    showRow(row);
    setView("editor");                                 // the builder asks for the panel when it's ready
  }
  async function switchTo(id) {                        // from the builder's dropdown
    await flushAndSave();
    const row = await fetchRow(id); if (!row) { sendList(); return; }
    showRow(row);
    post({ type: "np:load", project: row.data, id: row.id });
    sendList();
  }
  function startBlank(kind) {
    rowIdRef.current = null; pendingRef.current = null; setHasRow(false);
    setTitle(""); setFiles([]); setSavedAt(null); setStatus("idle"); setFilesOpen(false);
    modeRef.current = { kind };
  }
  async function newInPlace() {                        // "New" inside the builder
    await flushAndSave();
    startBlank("new");
    post({ type: "np:new" });
    sendList();
  }
  async function duplicateRow(id, openCopy) {
    const row = await fetchRow(id); if (!row) return;
    const copy = JSON.parse(JSON.stringify(row.data || {}));
    copy.id = newProjectId();
    copy.name = `${row.name || "Untitled product"} (copy)`;
    const { data, error } = await supabase.from("panel_projects").insert({
      panel_type: row.panel_type, name: copy.name, customer: row.customer, coman: row.coman,
      data: copy, created_by: userEmail, updated_by: userEmail,
    }).select("*").single();
    if (error || !data) { toast.error("Couldn't duplicate that panel."); return; }
    toast.success("Panel duplicated.");
    await load();
    if (openCopy) { showRow(data); post({ type: "np:load", project: data.data, id: data.id }); }
  }
  async function duplicateInPlace() {                  // "Duplicate" inside the builder
    await flushAndSave();
    if (!rowIdRef.current) { toast.error("Save this panel first (make an edit), then duplicate."); return; }
    await duplicateRow(rowIdRef.current, true);
    sendList();
  }

  const newPanel = () => { startBlank("new"); setView("editor"); };
  const importSpec = () => { startBlank("import"); setView("editor"); };

  async function doDelete(r) {
    setConfirmDel(null);
    const row = await fetchRow(r.id);
    const paths = ((row && row.files) || []).map((f) => f.path).filter(Boolean);
    if (paths.length) { try { await supabase.storage.from(BUCKET).remove(paths); } catch { /* best effort */ } }
    const { error } = await supabase.from("panel_projects").delete().eq("id", r.id);
    if (error) { toast.error("Couldn't delete the panel."); return; }
    toast.success("Panel deleted.");
    if (rowIdRef.current === r.id) { rowIdRef.current = null; pendingRef.current = null; setView("list"); }
    load();
  }

  async function backToList() {
    await flushAndSave();
    setView("list");
    load();
  }

  // ---- messages from the builder -------------------------------------------
  useEffect(() => {
    if (view !== "editor") return undefined;
    function onMessage(e) {
      if (e.origin !== window.location.origin) return;
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const m = e.data || {};
      const mode = modeRef.current;
      if (m.type === "np:ready") {
        if (mode?.kind === "load") post({ type: "np:load", project: mode.project, id: mode.id });
        else if (mode?.kind === "new") post({ type: "np:new" });
        else if (mode?.kind === "import") post({ type: "np:import" });
        sendList();
      } else if (m.type === "np:change" && m.project) {
        if (!rowIdRef.current && mode?.kind === "import") return;   // demo product behind the import screen
        pendingRef.current = m.project;
        setTitle(m.project.name || "Untitled product");
        saveSoon();
      } else if (m.type === "np:created" && m.project) {
        // New panel (New, New from spec…, or Open… a .json file) → its own row.
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        queue(() => {
          rowIdRef.current = null; setHasRow(false); setFiles([]);
          pendingRef.current = m.project;
          setTitle(m.project.name || "Untitled product");
          return doSave();
        });
        modeRef.current = { kind: "load", project: m.project };
      } else if (m.type === "np:spec-file" && m.file) {
        storeSpecFile(m.file, m.mode);
      } else if (m.type === "np:switch" && m.id) {
        switchTo(m.id);
      } else if (m.type === "np:request") {
        if (m.action === "new") newInPlace();
        else if (m.action === "duplicate") duplicateInPlace();
      } else if (m.type === "np:import-cancelled") {
        if (!rowIdRef.current && m.mode !== "update") { setView("list"); load(); }
      } else if (m.type === "np:flushed") {
        flushWaiter.current?.();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }); // re-bound each render so handlers see current state

  // Warn before closing the tab with unsaved edits; save when leaving the page.
  useEffect(() => {
    if (view !== "editor") return undefined;
    const warn = (e) => { if (pendingRef.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); if (pendingRef.current) saveNow(); };
  }, [view, saveNow]);

  const delModal = confirmDel && createPortal(
    <div className="overlay" onClick={() => setConfirmDel(null)}>
      <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Delete “{confirmDel.name || "Untitled product"}”?</h2></div>
        <div className="modal-body"><p>This removes the panel and its spec files for everyone. It can’t be undone.</p></div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
          <button className="btn-danger" onClick={() => doDelete(confirmDel)}>Delete panel</button>
        </div>
      </div>
    </div>,
    document.body
  );

  // ---- list ---------------------------------------------------------------
  if (view === "list") {
    return (
      <>
        <div className="page-card">
          <div className="page-head">
            <div className="page-head-left">
              <h1 className="page-title">Panel Builder</h1>
              <span className="page-meta">{rows.length} {rows.length === 1 ? "panel" : "panels"}</span>
            </div>
            <div className="page-head-right">
              <button className="btn-ghost" onClick={importSpec}>New from spec…</button>
              <button className="btn-accent" onClick={newPanel}>+ New panel</button>
            </div>
          </div>
          {loading ? (
            <p className="muted" style={{ padding: "0 20px 20px" }}>Loading…</p>
          ) : rows.length === 0 ? (
            <div className="empty">
              <p className="empty-title">No panels yet</p>
              <p className="muted">Start from a co-man spec (PDF or Excel) or build a Supplement Facts panel from scratch.</p>
              <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                <button className="btn-ghost" onClick={importSpec}>New from spec…</button>
                <button className="btn-accent" onClick={newPanel}>+ New panel</button>
              </div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Product</th><th>Customer</th><th>Co-man</th><th className="num">Spec files</th><th>Last edited</th><th></th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="row" onClick={() => openPanel(r)}>
                      <td className="cell-title">{r.name || "Untitled product"}</td>
                      <td>{r.customer || "—"}</td>
                      <td>{r.coman || "—"}</td>
                      <td className="num">{(r.files || []).length || "—"}</td>
                      <td>{when(r.updated_at)}{r.updated_by ? ` · ${cap(firstName(r.updated_by))}` : ""}</td>
                      <td className="rfq-row-del" onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                        <button type="button" className="rfq-del-btn" style={{ color: "var(--ink-2)" }} onClick={() => duplicateRow(r.id, false)}>Duplicate</button>
                        <button type="button" className="rfq-del-btn" onClick={() => setConfirmDel(r)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {delModal}
      </>
    );
  }

  // ---- editor -------------------------------------------------------------
  const statusText =
    status === "saving" ? "Saving…" :
    status === "unsaved" ? "Unsaved changes" :
    status === "error" ? "Couldn’t save — click Save now to retry" :
    status === "saved" ? `Saved · ${when(savedAt)}` :
    modeRef.current?.kind === "import" ? "Choose a spec file to create a panel" : "";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12, position: "relative" }}>
        <button className="btn-ghost" onClick={backToList}>← All panels</button>
        <span className="page-meta" style={{ color: status === "error" ? "#d64545" : undefined }}>{statusText}</span>
        <span style={{ flex: 1 }} />
        {status === "unsaved" || status === "error" ? <button className="btn-ghost" onClick={saveNow}>Save now</button> : null}
        {hasRow ? (
          <div style={{ position: "relative" }}>
            <button className="btn-ghost" onClick={() => setFilesOpen((v) => !v)} aria-expanded={filesOpen}>
              Spec files ({files.length}) ▾
            </button>
            {filesOpen && (
              <div style={{
                position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 20, width: 360, maxWidth: "80vw",
                background: "#fff", border: "0.5px solid var(--hairline)", borderRadius: 12,
                boxShadow: "0 12px 32px rgba(20,22,40,.14)", padding: 6,
              }}>
                {files.length === 0 ? (
                  <p className="muted" style={{ padding: "10px 12px", fontSize: 13 }}>
                    No spec files yet. Use “New from spec…” or “Update from spec…” in the builder — every file you import is kept here.
                  </p>
                ) : files.map((f, i) => (
                  <button key={f.path} type="button" onClick={() => downloadFile(f)}
                    style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, width: "100%", textAlign: "left",
                      border: "none", background: "transparent", padding: "9px 12px", borderRadius: 8, cursor: "pointer" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--panel)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>
                      {f.name}{i === 0 ? <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>LATEST</span> : null}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                      {f.kind === "update" ? "Updated panel" : "Created panel"} · {when(f.uploaded_at)}{f.uploaded_by ? ` · ${cap(firstName(f.uploaded_by))}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
        {hasRow ? (
          <button className="btn-ghost rfq-del-btn" onClick={() => setConfirmDel({ id: rowIdRef.current, name: title })}>Delete</button>
        ) : null}
      </div>
      <iframe
        ref={frameRef}
        src={FRAME_SRC}
        title="Panel Builder"
        allow="clipboard-read; clipboard-write"
        style={{
          display: "block",
          width: "100%",
          height: "calc(100dvh - 72px - 2 * clamp(16px, 3vw, 40px) - 56px)",
          minHeight: 600,
          border: 0,
          background: "transparent",
        }}
      />
      {delModal}
    </>
  );
}
