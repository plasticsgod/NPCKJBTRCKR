import { useState } from "react";
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
const HDR = /^(?:LCL shipment for\s+)?(\d+\s*(?:oz|mm))\s+(tubs?|caps?)\s*(?:\(.*\))?$/i;
const QTY = /Total quantity shipped\s+([\d,]+)/i;

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
      acc.set(cur, (acc.get(cur) || 0) + parseInt(q[1].replace(/,/g, ""), 10));
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
  const [items, setItems] = useState([]);   // [ [product, qty], ... ]
  const [fileNames, setFileNames] = useState([]);

  async function onFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => /\.pdf$/i.test(f.name));
    if (!files.length) return;
    setBusy(true);
    try {
      const acc = new Map();
      // Merge existing parsed items so repeated uploads add on.
      items.forEach(([p, q]) => acc.set(p, q));
      for (const f of files) {
        const lines = await extractLines(f);
        parseInto(lines, acc);
      }
      const sorted = sortItems(acc.entries());
      setItems(sorted);
      setFileNames((prev) => [...prev, ...files.map((f) => f.name)]);
      if (sorted.length === 0) toast.error("No tub/cap quantities found in those PDFs.");
    } catch (e) {
      console.error("[packing-list]", e);
      toast.error("Couldn't read those PDFs. Make sure they're the packing-list format.");
    } finally {
      setBusy(false);
    }
  }

  function reset() { setItems([]); setFileNames([]); }

  async function createOrder() {
    if (items.length === 0) return;
    setCreating(true);
    const total = items.reduce((s, [, q]) => s + q, 0);
    const description = items.map(([p, q]) => `${q.toLocaleString()} × ${p}`).join("\n");
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

  const total = items.reduce((s, [, q]) => s + q, 0);

  if (!open) {
    return (
      <button className="btn-ghost pli-open" onClick={() => setOpen(true)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
          <path d="M9 13h6M9 17h4" />
        </svg>
        Import packing list
      </button>
    );
  }

  return (
    <div className="pli-panel">
      <div className="pli-head">
        <span className="pli-title">Import from packing lists</span>
        <button className="link" onClick={() => { reset(); setOpen(false); }}>Close</button>
      </div>

      <label className={"pli-drop" + (busy ? " busy" : "")}>
        <input type="file" accept="application/pdf" multiple style={{ display: "none" }}
          onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} disabled={busy} />
        <span>{busy ? "Reading PDFs…" : "Click to add packing-list PDFs"}</span>
        <span className="muted small">Tub type + quantity are read automatically. Add several — they combine into one order.</span>
      </label>

      {fileNames.length > 0 && (
        <div className="pli-files muted small">{fileNames.length} file{fileNames.length === 1 ? "" : "s"}: {fileNames.join(", ")}</div>
      )}

      {items.length > 0 && (
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
          <div className="pli-actions">
            <button className="btn-ghost" onClick={reset} disabled={creating}>Clear</button>
            <button className="btn-accent" onClick={createOrder} disabled={creating}>
              {creating ? "Creating…" : "Create work order"}
            </button>
          </div>
          <p className="muted small pli-note">Creates one order on Plastics Work Orders (customer blank) for you to finish editing.</p>
        </>
      )}
    </div>
  );
}
