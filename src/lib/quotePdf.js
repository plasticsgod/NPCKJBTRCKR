// Branded quote PDFs — restyled to the current app look (near-black + system
// blue, clean/minimal). Two exports:
//   buildQuotePDF        internal draft, splits Product / Freight / Duty
//   buildClientQuotePDF  client-facing, final prices only (no breakdown)
// Both render the quote's note (if any) as part of the document.

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
const LINE = [227, 227, 232];
const PANEL = [245, 245, 247];

const usd = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd4 = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

function header(doc, W, M, tag) {
  doc.setFillColor(...INK); doc.rect(0, 0, W, 76, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(21);
  doc.text("NUTRAPACK", M, 40);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(180, 180, 186);
  doc.text("Tub & Lid Pricing", M, 56);
  doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
  const tw = doc.getTextWidth(tag) + 24;
  doc.setFillColor(...ACCENT); doc.roundedRect(W - M - tw, 26, tw, 26, 13, 13, "F");
  doc.setTextColor(255); doc.text(tag, W - M - tw / 2, 43, { align: "center" });
  return 108;
}

function metaRow(doc, W, M, y, customer, ds) {
  doc.setTextColor(...SOFT); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text("Prepared for", M, y);
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text(String(customer || "-"), M, y + 16);
  doc.setTextColor(...SOFT); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text("Date", W - M, y, { align: "right" });
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text(ds, W - M, y + 16, { align: "right" });
  return y + 40;
}

function notePanel(doc, W, M, y, note) {
  if (!note || !String(note).trim()) return y;
  const text = String(note).trim();
  const inner = W - 2 * M - 28;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  const lines = doc.splitTextToSize(text, inner);
  const h = 30 + lines.length * 13;
  doc.setFillColor(...PANEL); doc.roundedRect(M, y, W - 2 * M, h, 10, 10, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...SOFT);
  doc.text("NOTE", M + 14, y + 18);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text(lines, M + 14, y + 33);
  return y + h + 18;
}

function footer(doc, W, M, disc) {
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...FAINT);
  doc.text(doc.splitTextToSize(disc, W - 2 * M), M, 762);
}

export async function buildQuotePDF(quote) {
  let J;
  try { J = await loadJsPDF(); }
  catch { alert("PDF library is still loading - check your connection and try again."); return; }

  const doc = new J({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth(), M = 50;

  let y = header(doc, W, M, "DRAFT QUOTE");
  const today = new Date(), ds = (quote.quote_date || today.toISOString().slice(0, 10));
  y = metaRow(doc, W, M, y, quote.customer, ds);

  const cUnit = W - M - 150, cTot = W - M - 4;
  doc.setFillColor(...INK); doc.roundedRect(M, y - 13, W - 2 * M, 24, 6, 6, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  doc.text("LINE ITEMS", M + 10, y + 3);
  doc.text("PER UNIT", cUnit, y + 3, { align: "right" });
  doc.text("AMOUNT", cTot, y + 3, { align: "right" });
  y += 30;

  const compRow = (lab, perU, amt, bold) => {
    doc.setFontSize(10); doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setTextColor(...(bold ? INK : SOFT)); doc.text(lab, M + 14, y);
    if (perU != null) { doc.setFont("helvetica", "normal"); doc.setTextColor(...SOFT); doc.text("$" + perU.toFixed(3), cUnit, y, { align: "right" }); }
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setTextColor(...(bold ? INK : SOFT)); doc.text(usd(amt), cTot, y, { align: "right" });
    y += 15;
  };

  let sumP = 0, sumF = 0, sumD = 0;
  (quote.lines || []).forEach((l) => {
    if (y > 660) { doc.addPage(); y = 60; }
    const productU = Math.max(l.unit - l.freightU - l.dutyU, 0);
    const eP = productU * l.units, eF = l.freightU * l.units, eD = l.dutyU * l.units;
    sumP += eP; sumF += eF; sumD += eD;
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...INK); doc.text(l.name, M, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...SOFT); doc.text("Qty  " + l.units.toLocaleString(), cTot, y, { align: "right" });
    y += 17;
    compRow("Product", productU, eP, false);
    compRow("Freight & handling", l.freightU, eF, false);
    if (l.dutyIncluded) {
      doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor(...SOFT); doc.text("Duty / tariff", M + 14, y);
      doc.setFont("helvetica", "italic"); doc.text("included in pricing", cTot, y, { align: "right" }); doc.setFont("helvetica", "normal"); y += 15;
    } else { compRow("Duty / tariff", l.dutyU, eD, false); }
    doc.setDrawColor(...LINE); doc.line(M + 14, y - 9, cTot, y - 9);
    compRow("Line total", l.unit, l.unit * l.units, true);
    y += 12;
  });

  if (y > 640) { doc.addPage(); y = 60; }
  doc.setDrawColor(...LINE); doc.setLineWidth(1); doc.line(M, y, W - M, y); doc.setLineWidth(0.2); y += 20;
  const sline = (lab, amt) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...SOFT); doc.text(lab, cUnit, y, { align: "right" });
    doc.setTextColor(...INK); doc.text(usd(amt), cTot, y, { align: "right" }); y += 17;
  };
  sline("Product subtotal", sumP); sline("Freight & handling", sumF);
  if (sumD > 0.0001) sline("Duty / tariff", sumD);
  else {
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...SOFT); doc.text("Duty / tariff", cUnit, y, { align: "right" });
    doc.setFont("helvetica", "italic"); doc.text("included in pricing", cTot, y, { align: "right" }); doc.setFont("helvetica", "normal"); y += 17;
  }
  y += 6; doc.setDrawColor(...LINE); doc.line(cUnit - 130, y - 2, cTot, y - 2); y += 20;
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...INK); doc.text("TOTAL", cUnit, y, { align: "right" });
  doc.setTextColor(...ACCENT); doc.text(usd(sumP + sumF + sumD), cTot, y, { align: "right" });
  y += 30;

  y = notePanel(doc, W, M, y, quote.note);

  footer(doc, W, M, "DRAFT - indicative pricing for discussion only. Not a purchase order, invoice, or binding offer. Prices are subject to confirmation of freight rates and applicable duties/tariffs at time of order.");
  doc.save("Nutrapack-Draft-Quote-" + ds + ".pdf");
}

export async function buildClientQuotePDF(quote) {
  let J;
  try { J = await loadJsPDF(); }
  catch { alert("PDF library is still loading - check your connection and try again."); return; }

  const doc = new J({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth(), M = 50;

  let y = header(doc, W, M, "QUOTE");
  const ds = (quote.quote_date || new Date().toISOString().slice(0, 10));
  y = metaRow(doc, W, M, y, quote.customer, ds);

  const cUnit = W - M - 150, cTot = W - M - 4;
  doc.setFillColor(...INK); doc.roundedRect(M, y - 13, W - 2 * M, 24, 6, 6, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  doc.text("LINE ITEMS", M + 10, y + 3);
  doc.text("PER UNIT", cUnit, y + 3, { align: "right" });
  doc.text("AMOUNT", cTot, y + 3, { align: "right" });
  y += 30;

  let total = 0;
  (quote.lines || []).forEach((l) => {
    if (y > 660) { doc.addPage(); y = 60; }
    total += l.total;
    doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(l.name, M, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...SOFT);
    doc.text(usd4(l.unit), cUnit, y, { align: "right" });
    doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
    doc.text(usd(l.total), cTot, y, { align: "right" });
    y += 14;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...SOFT);
    doc.text("Qty  " + l.units.toLocaleString() + " units", M, y);
    y += 16;
    doc.setDrawColor(...LINE); doc.line(M, y - 4, W - M, y - 4);
    y += 10;
  });

  y += 4; doc.setDrawColor(...LINE); doc.line(cUnit - 130, y - 2, cTot, y - 2); y += 20;
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...INK);
  doc.text("TOTAL", cUnit, y, { align: "right" });
  doc.setTextColor(...ACCENT); doc.text(usd(total), cTot, y, { align: "right" });
  y += 30;

  doc.setFillColor(...PANEL); doc.roundedRect(M, y - 12, W - 2 * M, 34, 10, 10, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...ACCENT);
  doc.text("Prices exclude shipping.", M + 14, y + 8);
  doc.setFont("helvetica", "normal"); doc.setTextColor(...SOFT);
  doc.text("Contact us for freight pricing.", M + 14 + doc.getTextWidth("Prices exclude shipping. ") + 4, y + 8);
  y += 42;

  y = notePanel(doc, W, M, y, quote.note);

  footer(doc, W, M, "Estimate only - not a binding offer. Pricing subject to change.");
  doc.save("nutrapack-quote-" + ds + ".pdf");
}
