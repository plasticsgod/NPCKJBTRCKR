// Branded draft-quote PDF — ported from the original tool's buildPDF().
// Splits each line into Product / Freight / Duty so the customer can verify
// pass-throughs but the margin is never recoverable (Product absorbs markup).
// Loads jsPDF from CDN on first use (no bundler dependency).

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

export async function buildQuotePDF(quote) {
  let J;
  try { J = await loadJsPDF(); }
  catch { alert("PDF library is still loading — check your connection and try again."); return; }

  const doc = new J({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth(), M = 50;
  const navy = [17, 17, 17], ink = [17, 17, 17], soft = [106, 106, 106], signal = [255, 91, 31], line = [212, 207, 198];
  const usd = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  doc.setFillColor(...navy); doc.rect(0, 0, W, 72, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.text("NUTRAPACK", M, 42);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(166, 162, 154); doc.text("Tub & Lid Pricing", M, 57);
  doc.setFillColor(...signal); doc.rect(W - M - 120, 23, 120, 28, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("DRAFT QUOTE", W - M - 108, 41);

  let y = 104;
  const today = new Date(), ds = today.toISOString().slice(0, 10);
  const meta = (lx, lab, val, vx) => {
    doc.setTextColor(...soft); doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.text(lab, lx, y);
    doc.setTextColor(...ink); doc.setFont("helvetica", "bold"); doc.text(String(val), vx, y);
  };
  meta(M, "Prepared for:", quote.customer || "—", M + 78);
  meta(W - M - 185, "Date:", ds, W - M - 135); y += 26;

  const cUnit = W - M - 150, cTot = W - M - 8;
  doc.setFillColor(...navy); doc.rect(M, y - 13, W - 2 * M, 22, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  doc.text("LINE ITEMS", M + 8, y + 2); doc.text("PER UNIT", cUnit, y + 2, { align: "right" }); doc.text("AMOUNT", cTot, y + 2, { align: "right" });
  y += 26;

  const compRow = (lab, perU, amt, bold) => {
    doc.setFontSize(10); doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setTextColor(...(bold ? ink : soft)); doc.text(lab, M + 14, y);
    if (perU != null) { doc.setFont("helvetica", "normal"); doc.setTextColor(...soft); doc.text("$" + perU.toFixed(3), cUnit, y, { align: "right" }); }
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setTextColor(...(bold ? ink : soft)); doc.text(usd(amt), cTot, y, { align: "right" });
    y += 15;
  };

  let sumP = 0, sumF = 0, sumD = 0;
  quote.lines.forEach((l) => {
    if (y > 680) { doc.addPage(); y = 60; }
    const productU = Math.max(l.unit - l.freightU - l.dutyU, 0);
    const eP = productU * l.units, eF = l.freightU * l.units, eD = l.dutyU * l.units;
    sumP += eP; sumF += eF; sumD += eD;
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...ink); doc.text(l.name, M, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...soft); doc.text("Qty  " + l.units.toLocaleString(), cTot, y, { align: "right" });
    y += 17;
    compRow("Product", productU, eP, false);
    compRow("Freight & handling", l.freightU, eF, false);
    if (l.dutyIncluded) {
      doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor(...soft); doc.text("Duty / tariff", M + 14, y);
      doc.setFont("helvetica", "italic"); doc.text("included in pricing", cTot, y, { align: "right" }); doc.setFont("helvetica", "normal"); y += 15;
    } else { compRow("Duty / tariff", l.dutyU, eD, false); }
    doc.setDrawColor(...line); doc.line(M + 14, y - 9, cTot, y - 9);
    compRow("Line total", l.unit, l.unit * l.units, true);
    y += 12;
  });

  if (y > 650) { doc.addPage(); y = 60; }
  doc.setDrawColor(...ink); doc.setLineWidth(1); doc.line(M, y, W - M, y); doc.setLineWidth(0.2); y += 20;
  const sline = (lab, amt) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...soft); doc.text(lab, cUnit, y, { align: "right" });
    doc.setTextColor(...ink); doc.text(usd(amt), cTot, y, { align: "right" }); y += 17;
  };
  sline("Product subtotal", sumP); sline("Freight & handling", sumF);
  if (sumD > 0.0001) sline("Duty / tariff", sumD);
  else {
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...soft); doc.text("Duty / tariff", cUnit, y, { align: "right" });
    doc.setFont("helvetica", "italic"); doc.text("included in pricing", cTot, y, { align: "right" }); doc.setFont("helvetica", "normal"); y += 17;
  }
  y += 4; doc.setDrawColor(...line); doc.line(cUnit - 130, y - 2, cTot, y - 2); y += 18;
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...ink); doc.text("TOTAL", cUnit, y, { align: "right" });
  doc.setTextColor(...signal); doc.text(usd(sumP + sumF + sumD), cTot, y, { align: "right" });
  y += 34;

  doc.setFont("helvetica", "italic"); doc.setFontSize(8.5); doc.setTextColor(...soft);
  const disc = "DRAFT — indicative pricing for discussion only. Not a purchase order, invoice, or binding offer. Prices are subject to confirmation of freight rates and applicable duties/tariffs at time of order.";
  doc.text(doc.splitTextToSize(disc, W - 2 * M), M, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.text("Generated " + today.toLocaleString(), M, 772);
  doc.save(`Nutrapack-Draft-Quote-${ds}.pdf`);
}

// ---------------------------------------------------------------------------
// CLIENT quote PDF — final prices only. Deliberately does NOT break lines into
// product / freight / duty (that structure is internal). Shipping is excluded
// and stated as such.
// ---------------------------------------------------------------------------
export async function buildClientQuotePDF(quote) {
  let J;
  try { J = await loadJsPDF(); }
  catch { alert("PDF library is still loading — check your connection and try again."); return; }

  const doc = new J({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth(), M = 50;
  const navy = [17, 17, 17], ink = [17, 17, 17], soft = [106, 106, 106], signal = [255, 91, 31], line = [212, 207, 198];
  const usd = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const usd4 = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

  doc.setFillColor(...navy); doc.rect(0, 0, W, 72, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.text("NUTRAPACK", M, 42);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(166, 162, 154); doc.text("Tub & Lid Pricing", M, 57);
  doc.setFillColor(...signal); doc.rect(W - M - 120, 23, 120, 28, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("QUOTE", W - M - 88, 41);

  let y = 104;
  const ds = (quote.quote_date || new Date().toISOString().slice(0, 10));
  const meta = (lx, lab, val, vx) => {
    doc.setTextColor(...soft); doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.text(lab, lx, y);
    doc.setTextColor(...ink); doc.setFont("helvetica", "bold"); doc.text(String(val), vx, y);
  };
  meta(M, "Prepared for:", quote.customer || "—", M + 78);
  meta(W - M - 185, "Date:", ds, W - M - 135); y += 26;

  const cUnit = W - M - 150, cTot = W - M - 8;
  doc.setFillColor(...navy); doc.rect(M, y - 13, W - 2 * M, 22, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  doc.text("LINE ITEMS", M + 8, y + 2);
  doc.text("PER UNIT", cUnit, y + 2, { align: "right" });
  doc.text("AMOUNT", cTot, y + 2, { align: "right" });
  y += 26;

  let total = 0;
  (quote.lines || []).forEach((l) => {
    total += l.total;
    doc.setTextColor(...ink); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(l.name, M + 8, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(usd4(l.unit), cUnit, y, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(usd(l.total), cTot, y, { align: "right" });
    y += 14;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...soft);
    doc.text("Qty  " + l.units.toLocaleString() + " units", M + 8, y);
    y += 18;
    doc.setDrawColor(...line); doc.line(M, y - 6, W - M, y - 6);
    y += 8;
  });

  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...ink);
  doc.text("TOTAL", cUnit, y + 6, { align: "right" });
  doc.text(usd(total), cTot, y + 6, { align: "right" });
  y += 34;

  // The shipping notice — required on every client quote.
  doc.setFillColor(247, 245, 241); doc.rect(M, y - 12, W - 2 * M, 34, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...signal);
  doc.text("Prices exclude shipping.", M + 10, y + 4);
  doc.setFont("helvetica", "normal"); doc.setTextColor(...soft);
  doc.text("Contact us for freight pricing.", M + 10 + doc.getTextWidth("Prices exclude shipping. ") + 4, y + 4);
  y += 40;

  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...soft);
  doc.text("Estimate only — not a binding offer. Pricing subject to change.", M, y);

  doc.save(`nutrapack-quote-${ds}.pdf`);
}
