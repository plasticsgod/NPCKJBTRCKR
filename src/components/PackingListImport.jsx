import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../supabaseClient";
import { toast } from "./Toaster";

// pdf.js is loaded from a CDN at runtime (ESM). This avoids bundling a worker
// through Vite. The module is cached after first load.
const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.min.mjs";
const WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs";
let _pdfjs = null;
async function getPdfjs() {
  if (_pdfjs) return _pdfjs;
  const mod = await import(/* @vite-ignore */ PDFJS_URL);
  mod.GlobalWorkerOptions.workerSrc = WORKER_URL;
  _pdfjs = mod;
  return mod;
}

// Reconstruct text lines from a page's positioned text items (group by y, sort by x).
async function extractLines(file) {
  const pdfjs = await getPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const lines = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const rows = {};
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      (rows[y] = rows[y] || []).push({ x: it.transform[4], s: it.str });
    }
    Object.keys(rows).map(Number).sort((a, b) => b - a).forEach((y) => {
      const line = rows[y].sort((a, b) => a.x - b.x).map((o) => o.s).join(" ").replace(/\s+/g, " ").trim();
      if (line) lines.push(line);
    });
  }
  return lines;
}

// A product header is a standalone line: optional "LCL shipment for", a size
// (Noz / Nmm), "tubs"/"caps", optional "(...)". Quantity is the following
// "Total quantity shipped N". Products repeated across sections are summed.
//
// pdf.js can insert synthetic spaces INSIDE a number or between a number and
// its unit (e.g. "20oz" extracts as "2 0 oz", "12,474" as "1 2,474"). Both
// patterns tolerate arbitrary internal whitespace; spaces are stripped after
// capture. See parseInto / the size normalization below.
const HDR = /^(?:LCL shipment for\s+)?(\d[\d\s]*(?:oz|mm))\s+(tubs?|caps?)\s*(?:\(.*\))?$/i;
const QTY = /Total quantity shipped\s+([\d\s,]+)/i;

function parseInto(lines, acc) {
  let cur = null;
  for (const l of lines) {
    const h = l.match(HDR);
    if (h) {
      const size = h[1].replace(/\s/g, "").toLowerCase();
      const kind = /tub/i.test(h[2]) ? "tub" : "cap";
      cur = `${size} ${kind}`;
      continue;
    }
    const q = l.match(QTY);
    if (q && cur) {
      acc.set(cur, (acc.get(cur) || 0) + parseInt(q[1].replace(/[\s,]/g, ""), 10));
      cur = null;
    }
  }
}

// Sort tubs before caps, ascending by numeric size.
function sortItems(entries) {
  return [...entries].sort((a, b) => {
    const [an, ak] = [parseInt(a[0], 10), a[0].includes("cap") ? 1 : 0];
    const [bn, bk] = [parseInt(b[0], 10), b[0].includes("cap") ? 1 : 0];
    return ak - bk || an - bn;
  });
}

export default function PackingListImport({ userEmail, onCreated }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Parsed results are kept PER FILE so one file can be removed without
  // redoing the whole import. [{ key, name, items: [[product, qty], ...] }]
  const [files, setFiles] = useState([]);

  // Merged totals across every file. Products repeated across files are summed.
  const items = useMemo(() => {
    const acc = new Map();
    for (const f of files) {
      for (const [p, q] of f.items) acc.set(p, (acc.get(p) || 0) + q);
    }
    return sortItems(acc.entries());
  }, [files]);

  const total = items.reduce((s, [, q]) => s + q, 0);

  // Esc closes the modal (but never mid-create).
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === "Escape" && !creating) { setFiles([]); setOpen(false); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, creating]);

  function reset() { setFiles([]); }

  function closeModal() { setFiles([]); setOpen(false); }

  function removeFile(key) {
    setFiles((prev) => prev.filter((f) => f.key !== key));
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    onFiles(e.dataTransfer.files);
  }

  async function onFiles(fileList) {
    const picked = Array.from(fileList || []).filter((f) => /\.pdf$/i.test(f.name));
    if (!picked.length) return;
    setBusy(true);
    try {
      const added = [];
      let dupes = 0;
      let empty = 0;
      for (const f of picked) {
        const key = `${f.name}:${f.size}`;
        if (files.some((x) => x.key === key) || added.some((x) => x.key === key)) { dupes++; continue; }
        const acc = new Map();
        const lines = await extractLines(f);
        parseInto(lines, acc);
        const parsed = sortItems(acc.entries());
        if (parsed.length === 0) empty++;
        added.push({ key, name: f.name, items: parsed });
      }
      if (added.length) setFiles((prev) => [...prev, ...added]);
      if (dupes) toast.error(`Skipped ${dupes} file${dupes === 1 ? "" : "s"} already added.`);
      if (empty) toast.error(`No tub/cap quantities found in ${empty} file${empty === 1 ? "" : "s"}.`);
    } catch (e) {
      console.error("[packing-list]", e);
      toast.error("Couldn't read those PDFs. Make sure they're the packing-list format.");
    } finally {
      setBusy(false);
    }
  }

  async function createOrder() {
    if (items.length === 0) return;
    setCreating(true);
    const description = items.map(([p, q]) => `${q.toLocaleString()} × ${p}`).join("\n");
    const fileNames = files.map((f) => f.name);
    const id = (crypto.randomUUID && crypto.randomUUID()) ||
      ("pli-" + Date.now() + "-" + Math.random().toString(16).slice(2));
    const { error } = await supabase.from("plastic_jobs").insert({
      id,
      job_title: "Imported packing list",
      brand: null,                 // customer left blank by choice
      description,
      qty: total,
      qty_unit: "units",
      cost: 0,
      revenue: 0,
      status: "Submitted",         // NOT NULL; approval:null puts it on the board
      approval: null,
      created_by: userEmail,
      pricing: { source: "packing_list", lines: items.map(([name, units]) => ({ name, units })), files: fileNames },
    });
    setCreating(false);
    if (error) { toast.error("Couldn't create the order. Please try again."); return; }
    toast.success("Work order created — find it on Plastics Work Orders to finish it.");
    reset();
    setOpen(false);
    onCreated && onCreated();
  }

  const hasFiles = files.length > 0;

  // The trigger stays mounted at all times so opening the importer never
  // reflows the estimator toolbar.
  return (
    <>
      <button className="btn-ghost pli-open" onClick={() => setOpen(true)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
          <path d="M9 13h6M9 17h4" />
        </svg>
        Import packing list
      </button>

      {open && createPortal(
        <div
          className="overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !creating) closeModal(); }}
        >
          <div className="modal pli-modal" role="dialog" aria-modal="true" aria-label="Import from packing lists">
            <div className="modal-head">
              <h2>Import from packing lists</h2>
              <button className="link" onClick={closeModal} disabled={creating}>Close</button>
            </div>

            <div className="modal-body pli-body">
              <label
                className={"pli-drop" + (busy ? " busy" : "") + (hasFiles ? " compact" : "") + (dragOver ? " dragover" : "")}
                onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true); }}
                onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
                onDrop={onDrop}
              >
                <input type="file" accept="application/pdf" multiple style={{ display: "none" }}
                  onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} disabled={busy} />
                <span className="pli-drop-main">
                  {busy
                    ? "Reading PDFs…"
                    : dragOver
                    ? "Drop packing-list PDFs"
                    : hasFiles
                    ? "Click or drag more PDFs"
                    : "Click or drag packing-list PDFs"}
                </span>
                {!hasFiles && (
                  <span className="muted small">
                    Tub type + quantity are read automatically. Add several — they combine into one order.
                  </span>
                )}
              </label>

              {hasFiles && (
                <div className="pli-files">
                  {files.map((f) => (
                    <div className="pli-file" key={f.key}>
                      <span className="pli-file-name" title={f.name}>{f.name}</span>
                      <span className="pli-file-meta muted small">
                        {f.items.length === 0
                          ? "nothing found"
                          : `${f.items.reduce((s, [, q]) => s + q, 0).toLocaleString()} units`}
                      </span>
                      <button
                        className="pli-file-x"
                        onClick={() => removeFile(f.key)}
                        disabled={creating}
                        aria-label={`Remove ${f.name}`}
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {items.length > 0 ? (
                <>
                  <div className="pli-preview">
                    {items.map(([p, q]) => (
                      <div className="pli-row" key={p}>
                        <span className="pli-prod">{p}</span>
                        <span className="pli-qty">{q.toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="pli-row pli-total">
                      <span className="pli-prod">Total units</span>
                      <span className="pli-qty">{total.toLocaleString()}</span>
                    </div>
                  </div>
                  <p className="muted small pli-note">
                    Creates one order on Plastics Work Orders (customer blank) for you to finish editing.
                  </p>
                </>
              ) : (
                <p className="muted small pli-empty">
                  {hasFiles
                    ? "No tub or cap quantities were found. Check that these are the packing-list format."
                    : "Parsed products will appear here before anything is created."}
                </p>
              )}
            </div>

            <div className="modal-foot">
              <button className="btn-ghost" onClick={reset} disabled={creating || !hasFiles}>Clear</button>
              <button className="btn-accent" onClick={createOrder} disabled={creating || busy || items.length === 0}>
                {creating ? "Creating…" : "Create work order"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
