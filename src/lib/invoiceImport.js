// Reads supplier invoice PDFs (Enki-style layout) in the browser and returns
// line items for Quick quote. No AI and no server: pdf.js pulls the text that's
// already inside the PDF, then we find the table using its column headers.
// Photos/scans have no text inside, so they return an empty result.
//
// Supplier details (name, SKUs, our PO numbers, "dropship") are deliberately
// dropped so nothing identifies the supplier on a quote we send to a client.

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

// Rows of positioned words: [{ y, items: [{ x, s }] }], top to bottom, per page.
async function readRows(buf, pdfjsOverride) {
  const pdfjs = pdfjsOverride || (await getPdfjs());
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const rows = {};
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      (rows[y] = rows[y] || []).push({ x: it.transform[4], s: it.str.trim() });
    }
    pages.push(Object.keys(rows).map(Number).sort((a, b) => b - a)
      .map((y) => ({ y, items: rows[y].sort((a, b) => a.x - b.x) })));
  }
  return pages;
}

const NUM = /^\$?-?[\d,]*\.?\d+$/;
const toNum = (s) => parseFloat(String(s).replace(/[$,]/g, ""));

// Supplier part codes -> plain product names ("TB-8OZ-White-HDPE" -> "8oz Tub · White HDPE").
function prettify(s) {
  let m = s.match(/^TB-(\d+)\s*OZ[-\s]*(.*)$/i);
  if (m) return `${m[1]}oz Tub${m[2] ? " · " + m[2].replace(/-/g, " ").trim() : ""}`;
  m = s.match(/^LD-(\d+)\s*MM[-\s]*(.*)$/i);
  if (m) return `${m[1]}mm Lid${m[2] ? " · " + m[2].trim() : ""}`;
  return s;
}

// Strip supplier / internal references from a description.
export function cleanDescription(s) {
  return prettify(String(s)
    .replace(/\bP\.?O\.?\s*#?\s*\d+\b/gi, "")   // our PO number on their invoice
    .replace(/[-–]?\s*drop\s*-?ship\b/gi, "")      // "dropship"
    .replace(/\s{2,}/g, " ")
    .replace(/[\s.,;:-]+$/g, "")
    .trim());
}

export function parseInvoiceRows(pages) {
  const lines = [];
  let balanceDue = null;
  for (const rows of pages) {
    // Find the table header (DESCRIPTION + QTY) to learn the column positions.
    const hIdx = rows.findIndex((r) => {
      const t = r.items.map((i) => i.s.toUpperCase());
      return t.some((s) => s.startsWith("DESCRIPTION")) && t.some((s) => s === "QTY" || s === "QUANTITY");
    });
    // Balance due / total, used to double-check the parse.
    for (const r of rows) {
      const t = r.items.map((i) => i.s).join(" ");
      const m = t.match(/BALANCE DUE\s*\$?\s*([\d,]+\.\d{2})/i) || t.match(/^TOTAL\s*\$?\s*([\d,]+\.\d{2})/i);
      if (m) balanceDue = toNum(m[1]);
    }
    if (hIdx === -1) continue;
    const head = rows[hIdx].items;
    const descX = head.find((i) => i.s.toUpperCase().startsWith("DESCRIPTION")).x;
    const qtyX = head.find((i) => ["QTY", "QUANTITY"].includes(i.s.toUpperCase())).x;

    let current = null;
    for (const r of rows.slice(hIdx + 1)) {
      const text = r.items.map((i) => i.s).join(" ");
      if (/BALANCE DUE|^TOTAL\b|SUBTOTAL|remit|Thank you/i.test(text)) break;
      const nums = r.items.filter((i) => NUM.test(i.s) && i.x > qtyX - 60);
      const descWords = r.items.filter((i) => i.x >= descX - 6 && i.x < qtyX - 60 && !NUM.test(i.s));
      if (nums.length >= 3) {
        const [q, u, t] = nums.slice(-3).map((n) => toNum(n.s));
        current = { desc: descWords.map((i) => i.s).join(" "), qty: q, unitCost: u, total: t };
        lines.push(current);
      } else if (current && descWords.length) {
        current.desc += " " + descWords.map((i) => i.s).join(" ");   // wrapped description
      }
    }
  }
  const out = lines.map((l) => ({ ...l, desc: cleanDescription(l.desc) }));
  const sum = Math.round(out.reduce((s, l) => s + l.qty * l.unitCost, 0) * 100) / 100;
  return { lines: out, sum, balanceDue, matches: balanceDue != null && Math.abs(sum - balanceDue) < 0.02 };
}

// Main entry: File -> { lines, sum, balanceDue, matches }
export async function importInvoice(file, pdfjsOverride) {
  const buf = new Uint8Array(await file.arrayBuffer());
  return parseInvoiceRows(await readRows(buf, pdfjsOverride));
}
