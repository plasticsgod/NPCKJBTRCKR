// RFQ PDFs — branded to the app look (near-black + system blue), matching the
// quote PDFs. Generates the outbound RFQ (one per vendor, re-addressed) and the
// internal spec, then merges any attachment PDFs after the RFQ pages.
//   jsPDF (CDN) builds the pages; pdf-lib merges attachments.
import { PDFDocument } from "pdf-lib";

let jsPDFPromise = null;
function loadJsPDF() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (!jsPDFPromise) {
    jsPDFPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload = () => resolve(window.jspdf.jsPDF);
      s.onerror = () => reject(new Error("Could not load the PDF library."));
      document.head.appendChild(s);
    });
  }
  return jsPDFPromise;
}

const INK = [29, 29, 31];
const SOFT = [110, 110, 115];
const FAINT = [161, 161, 166];
const ACCENT = [10, 132, 255];
const DANGER = [163, 45, 45];
const LINE = [227, 227, 232];
const PANEL = [245, 245, 247];

// App logo, served from public/images. Fetched once and cached as a data URL
// (with its natural pixel size, so we can scale it without distortion).
const LOGO_URL = "/images/logo.png";
let _logo = null; // { dataUrl, w, h } | false (failed)
async function getLogo() {
  if (_logo !== null) return _logo || null;
  try {
    const res = await fetch(LOGO_URL);
    const blob = await res.blob();
    const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    const dim = await new Promise((r) => { const im = new Image(); im.onload = () => r({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => r(null); im.src = dataUrl; });
    _logo = dim ? { dataUrl, w: dim.w, h: dim.h } : false;
  } catch { _logo = false; }
  return _logo || null;
}

const num = (x) => Number(x) || 0;
const intFmt = (n) => Math.round(n).toLocaleString("en-US");

function header(doc, W, M, tag, tagColor, logo) {
  // White header band with a hairline divider (was near-black).
  doc.setFillColor(255, 255, 255); doc.rect(0, 0, W, 76, "F");
  doc.setDrawColor(...LINE); doc.setLineWidth(0.8); doc.line(0, 76, W, 76); doc.setLineWidth(0.2);
  let tx = M;
  if (logo) {
    // Fit the logo into a 40pt-tall band on the header, keep aspect ratio.
    const h = 40, w = (logo.w / logo.h) * h;
    try { doc.addImage(logo.dataUrl, "PNG", M, 18, w, h); tx = M + w + 14; } catch { tx = M; }
  }
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(21);
  doc.text("NUTRAPACK", tx, 40);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...SOFT);
  doc.text("Packaging brokerage", tx, 56);
  doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
  const tw = doc.getTextWidth(tag) + 24;
  doc.setFillColor(...tagColor); doc.roundedRect(W - M - tw, 26, tw, 26, 13, 13, "F");
  doc.setTextColor(255); doc.text(tag, W - M - tw / 2, 43, { align: "center" });
  return 104;
}

function metaRow(doc, W, M, y, rfqNo, dateStr, respondBy) {
  doc.setTextColor(...SOFT); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text("RFQ number", M, y);
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text(String(rfqNo || "—"), M, y + 16);
  doc.setTextColor(...SOFT); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text("Issued", W - M - 160, y); doc.text("Respond by", W - M, y, { align: "right" });
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text(dateStr, W - M - 160, y + 16);
  doc.text(respondBy || "—", W - M, y + 16, { align: "right" });
  return y + 40;
}

function addrRow(doc, W, M, y, toName, fromLine) {
  doc.setTextColor(...SOFT); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text("To", M, y); doc.text("From", W / 2, y);
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text(String(toName || "—"), M, y + 15);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...SOFT);
  doc.text("Attn: Sales / Estimating", M, y + 29);
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text("NutraPack", W / 2, y + 15);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...SOFT);
  doc.text(fromLine || "—", W / 2, y + 29);
  return y + 46;
}

function sectionTitle(doc, M, y, t) {
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...INK);
  doc.text(t, M, y); return y + 16;
}
function specRow(doc, W, M, y, k, v) {
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...SOFT);
  doc.text(k, M + 4, y);
  doc.setTextColor(...INK); doc.text(String(v == null || v === "" ? "—" : v), W - M - 4, y, { align: "right" });
  doc.setDrawColor(...LINE); doc.line(M, y + 5, W - M, y + 5);
  return y + 20;
}
function para(doc, W, M, y, text) {
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(60, 60, 62);
  const lines = doc.splitTextToSize(String(text || ""), W - 2 * M);
  doc.text(lines, M, y); return y + lines.length * 13 + 6;
}
function footer(doc, W, M, disc) {
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...FAINT);
  doc.text(doc.splitTextToSize(disc, W - 2 * M), M, 762);
}

// Derived quantities from the RFQ data blob.
function quantities(d) {
  const over = 1 + num(d.overage_pct) / 100;
  return {
    sticks: num(d.qty_per_variant), sticksO: num(d.qty_per_variant) * over,
    sachets: num(d.sachets_per_variant), sachetsO: num(d.sachets_per_variant) * over,
    overPct: num(d.overage_pct),
  };
}

// ---- Outbound RFQ (one vendor) --------------------------------------------
async function outboundDoc(rfq, vendor) {
  const J = await loadJsPDF();
  const doc = new J({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth(), M = 50;
  const d = rfq.data || {};
  const ds = new Date(rfq.created_at || Date.now()).toISOString().slice(0, 10);
  const logo = await getLogo();

  let y = header(doc, W, M, "REQUEST FOR QUOTATION", ACCENT, logo);
  y = metaRow(doc, W, M, y, rfq.rfq_number, ds, d.respond_by);
  y = addrRow(doc, W, M, y + 6, vendor, "Packaging brokerage");
  y += 6;

  y = para(doc, W, M, y, "We invite your quotation to supply the flexible packaging described below on a turnkey brokerage basis (" + (d.scope || "packaging only") + "). Freight: " + (d.freight || "—") + ".");

  const q = quantities(d);
  const qtyStr = (base, withOver) => (q.overPct > 0 ? `${intFmt(base)}  ->  ${intFmt(withOver)}` : intFmt(base));
  y = sectionTitle(doc, M, y + 4, "1 · Scope");
  y = para(doc, W, M, y, `${d.skus || "—"} finished SKU(s), each ${d.components_per_sku || "a printed component"} — ${d.sticks_per_sachet || "—"} sticks per sachet. ${d.notes ? d.notes : ""}`);

  y = sectionTitle(doc, M, y + 4, "2 · Quantities");
  y = specRow(doc, W, M, y, `Sticks per variant${q.overPct > 0 ? ` (+${q.overPct}% overage)` : ""}`, qtyStr(q.sticks, q.sticksO));
  y = specRow(doc, W, M, y, `Sachets per variant${q.overPct > 0 ? ` (+${q.overPct}% overage)` : ""}`, qtyStr(q.sachets, q.sachetsO));
  y = specRow(doc, W, M, y, "Finished SKUs", d.skus);

  y = sectionTitle(doc, M, y + 8, "3 · Materials & print");
  y = specRow(doc, W, M, y, "Sachet stock", d.sachet_stock);
  y = specRow(doc, W, M, y, "Lamination", d.lamination);
  y = specRow(doc, W, M, y, "Food grade", d.food_grade);
  y = specRow(doc, W, M, y, "Color", `${d.color_system || "—"}${d.color_match ? " · " + d.color_match : ""}`);
  y = specRow(doc, W, M, y, "Press technology", d.press_tech);

  y = sectionTitle(doc, M, y + 8, "4 · Artwork");
  y = para(doc, W, M, y, d.artwork_status || "—");

  y = sectionTitle(doc, M, y + 4, "5 · Commercial terms");
  y = specRow(doc, W, M, y, "Freight", d.freight);
  y = specRow(doc, W, M, y, "Shelf life", d.shelf_life);
  y = specRow(doc, W, M, y, "Respond by", d.respond_by);

  const encl = (d.attachments || []).map((a) => a.name);
  if (encl.length) {
    y = sectionTitle(doc, M, y + 8, "6 · Enclosures");
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...SOFT);
    y = para(doc, W, M, y, "Appended to this document:");
    encl.forEach((n) => { doc.setTextColor(...INK); doc.text("-  " + n, M + 4, y); y += 14; });
  }

  y = para(doc, W, M, y + 8, "Please include unit pricing at the quantities above, tooling/plate charges, lead time, and MOQ.");

  footer(doc, W, M, "Indicative RFQ for quotation purposes only. Not a purchase order or commitment. Pricing subject to confirmation of final artwork and specifications.");
  return new Uint8Array(doc.output("arraybuffer"));
}

// ---- Internal spec ---------------------------------------------------------
async function internalDoc(rfq) {
  const J = await loadJsPDF();
  const doc = new J({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth(), M = 50;
  const d = rfq.data || {};
  const ds = new Date(rfq.created_at || Date.now()).toISOString().slice(0, 10);
  const ct = d.cost_targets || {};
  const logo = await getLogo();

  let y = header(doc, W, M, "INTERNAL SPEC", DANGER, logo);
  y = metaRow(doc, W, M, y, rfq.rfq_number, ds, d.respond_by);
  y += 6;
  doc.setFillColor(...PANEL); doc.roundedRect(M, y, W - 2 * M, 22, 6, 6, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...DANGER);
  doc.text("INTERNAL — DO NOT DISTRIBUTE TO SUPPLIERS", M + 10, y + 14);
  y += 34;

  y = para(doc, W, M, y, `Project: ${d.project_ref || rfq.project_ref || "—"}. Everything on the outbound RFQ, plus the internal targets below.`);

  y = sectionTitle(doc, M, y + 4, "Target economics");
  y = specRow(doc, W, M, y, "Target landed / stick", ct.stick);
  y = specRow(doc, W, M, y, "Target landed / sachet", ct.sachet);

  y = sectionTitle(doc, M, y + 8, "Vendor strategy");
  y = para(doc, W, M, y, ct.strategy || "—");

  y = sectionTitle(doc, M, y + 4, "Vendors");
  (d.vendors || []).filter(Boolean).forEach((v) => { doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...INK); doc.text("-  " + v, M + 4, y); y += 14; });

  footer(doc, W, M, "Internal working document. Contains cost targets and negotiating strategy. Do not attach to supplier correspondence.");
  return new Uint8Array(doc.output("arraybuffer"));
}

// ---- Merge attachments after the RFQ pages ---------------------------------
async function mergeAttachments(baseBytes, attachments) {
  const out = await PDFDocument.create();
  const base = await PDFDocument.load(baseBytes);
  (await out.copyPages(base, base.getPageIndices())).forEach((p) => out.addPage(p));
  for (const a of attachments || []) {
    try {
      const src = await PDFDocument.load(a.bytes);
      (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
    } catch { /* skip an unreadable attachment rather than fail the whole doc */ }
  }
  return out.save();
}

function download(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Public: generate + download the outbound RFQ for one vendor (attachments
// merged). `attachments` = [{ name, bytes: Uint8Array }].
export async function downloadOutboundRFQ(rfq, vendor, attachments) {
  const base = await outboundDoc(rfq, vendor);
  const merged = await mergeAttachments(base, attachments);
  const safe = (vendor || "vendor").replace(/[^\w.-]+/g, "-");
  download(merged, `RFQ-${rfq.rfq_number || "draft"}-${safe}.pdf`);
}

// Public: generate + download the internal spec (no attachments).
export async function downloadInternalSpec(rfq) {
  const bytes = await internalDoc(rfq);
  download(bytes, `RFQ-${rfq.rfq_number || "draft"}-INTERNAL.pdf`);
}
