// Quick quote PDF — client-facing. Same look as the quote / RFQ PDFs (white
// header, logo, blue pill). Shows sell prices only, never cost or margin.
import { toast } from "../components/Toaster";
import { computeQuote, money } from "./quickQuote";

let jsPDFPromise = null;
function loadJsPDF() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (!jsPDFPromise) {
    jsPDFPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload = () => resolve(window.jspdf.jsPDF);
      s.onerror = () => { jsPDFPromise = null; reject(new Error("Could not load the PDF library.")); };
      document.head.appendChild(s);
    });
  }
  return jsPDFPromise;
}

let _logo = null;
async function getLogo() {
  if (_logo !== null) return _logo || null;
  try {
    const blob = await (await fetch("/images/logo.png")).blob();
    const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    const dim = await new Promise((r) => { const im = new Image(); im.onload = () => r({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => r(null); im.src = dataUrl; });
    _logo = dim ? { dataUrl, ...dim } : false;
  } catch { _logo = false; }
  return _logo || null;
}

const INK = [29, 29, 31], SOFT = [110, 110, 115], FAINT = [161, 161, 166];
const ACCENT = [10, 132, 255], LINE = [227, 227, 232], PANEL = [245, 245, 247];

export async function buildQuickQuotePDF(q) {
  let J;
  try { J = await loadJsPDF(); }
  catch { toast.error("Couldn't load the PDF tool — check your connection and try again."); return; }
  const doc = new J({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth(), M = 50;
  const logo = await getLogo();
  const { rows, sub, discount, shipping, total } = computeQuote(q.lines || []);

  // Header
  const header = () => {
    doc.setDrawColor(...LINE); doc.setLineWidth(0.8); doc.line(0, 76, W, 76); doc.setLineWidth(0.2);
    let tx = M;
    if (logo) { const h = 40, w = (logo.w / logo.h) * h; try { doc.addImage(logo.dataUrl, "PNG", M, 18, w, h); tx = M + w + 14; } catch { /* text only */ } }
    doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(21); doc.text("NUTRAPACK", tx, 40);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...SOFT); doc.text("Packaging", tx, 56);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
    const tag = "QUOTE", tw = doc.getTextWidth(tag) + 24;
    doc.setFillColor(...ACCENT); doc.roundedRect(W - M - tw, 26, tw, 26, 13, 13, "F");
    doc.setTextColor(255); doc.text(tag, W - M - tw / 2, 43, { align: "center" });
  };
  header();

  // Meta
  let y = 108;
  const ds = q.quote_date || new Date().toISOString().slice(0, 10);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...SOFT);
  doc.text("Prepared for", M, y); doc.text("Quote", W / 2, y); doc.text("Date", W - M, y, { align: "right" });
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...INK);
  doc.text(String(q.customer || "—"), M, y + 16);
  doc.text(String(q.quote_number || "—"), W / 2, y + 16);
  doc.text(ds, W - M, y + 16, { align: "right" });
  y += 44;

  // Table head
  const cPrice = W - M - 190, cQty = W - M - 100, cAmt = W - M - 4, descW = cPrice - M - 70;
  const thead = () => {
    doc.setFillColor(...INK); doc.roundedRect(M, y - 13, W - 2 * M, 24, 6, 6, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text("ITEM", M + 10, y + 3); doc.text("PRICE", cPrice, y + 3, { align: "right" });
    doc.text("QTY", cQty, y + 3, { align: "right" }); doc.text("AMOUNT", cAmt, y + 3, { align: "right" });
    y += 30;
  };
  thead();

  const itemRows = rows.filter((r) => ["item", "services", "packaging"].includes(r.kind) && (r.line.item || r.line.desc || r.amount != null));
  for (const r of itemRows) {
    const l = r.line;
    const label = r.kind === "item" ? (l.item || "") : r.kind === "services" ? "Services" : "Packaging";
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    const descLines = doc.splitTextToSize(String(l.desc || "—"), descW);
    const rowH = (label ? 12 : 0) + descLines.length * 13 + 10;
    if (y + rowH > 700) { doc.addPage(); header(); y = 108; thead(); }
    let yy = y;
    if (label) { doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...FAINT); doc.text(label.toUpperCase(), M + 10, yy); yy += 12; }
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...INK); doc.text(descLines, M + 10, yy);
    doc.setTextColor(...SOFT);
    doc.text(money(r.unit, r.kind === "packaging" ? 4 : 2), cPrice, y, { align: "right" });
    doc.text(l.qty ? `${Number(l.qty).toLocaleString("en-US")}${r.kind === "services" ? " hrs" : ""}` : "—", cQty, y, { align: "right" });
    doc.setFont("helvetica", "bold"); doc.setTextColor(...INK); doc.text(money(r.amount), cAmt, y, { align: "right" });
    y += rowH;
    doc.setDrawColor(...LINE); doc.line(M, y - 8, W - M, y - 8);
  }

  // Summary
  if (y > 640) { doc.addPage(); header(); y = 108; }
  y += 8;
  const sline = (lab, amt, bold) => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(bold ? 14 : 10);
    doc.setTextColor(...(bold ? INK : SOFT)); doc.text(lab, cQty, y, { align: "right" });
    doc.setTextColor(...(bold ? ACCENT : INK)); doc.text(money(amt), cAmt, y, { align: "right" });
    y += bold ? 24 : 17;
  };
  sline("Subtotal", sub);
  const d = rows.find((r) => r.kind === "discount" && r.amount), s = rows.find((r) => r.kind === "shipping" && r.amount);
  if (discount) sline(`Discount${d && d.line.mode !== "flat" ? ` (${d.line.value}%)` : ""}`, discount);
  if (shipping) sline("Shipping", shipping);
  doc.setDrawColor(...LINE); doc.line(cQty - 120, y - 8, cAmt, y - 8); y += 6;
  sline("TOTAL", total, true);
  if (s?.line.desc) { doc.setFont("helvetica", "italic"); doc.setFontSize(8.5); doc.setTextColor(...SOFT); doc.text(`Shipping: ${s.line.desc}`, cAmt, y - 8, { align: "right" }); y += 6; }

  // Notes
  const note = String(q.notes || "").trim();
  if (note) {
    y += 10;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    const nl = doc.splitTextToSize(note, W - 2 * M - 28);
    const h = 30 + nl.length * 13;
    if (y + h > 740) { doc.addPage(); header(); y = 108; }
    doc.setFillColor(...PANEL); doc.roundedRect(M, y, W - 2 * M, h, 10, 10, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...SOFT); doc.text("NOTE", M + 14, y + 18);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...INK); doc.text(nl, M + 14, y + 33);
  }

  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...FAINT);
  doc.text("Estimate only — not a binding offer. Pricing subject to change.", M, 762);
  doc.save(`NutraPack-Quote-${q.quote_number || ds}.pdf`);
}
