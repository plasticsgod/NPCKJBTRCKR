// Generates a branded NutraPack Proof cover sheet and optionally merges it
// with an uploaded PDF. Uses pdf-lib (browser-compatible, no server needed).
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

// App palette — matches the quote / RFQ PDFs (white header, blue accent).
const ACCENT  = rgb(0.039, 0.518, 1);     // #0a84ff
const INK     = rgb(0.114, 0.114, 0.122); // #1d1d1f
const MUTED   = rgb(0.431, 0.431, 0.451); // #6e6e73
const HAIRLINE= rgb(0.890, 0.890, 0.910); // #e3e3e8

export async function buildProofPDF({ jobTitle, customer, uploadedBy, date, fileName, logoUrl }) {
  const doc   = await PDFDocument.create();
  const page  = doc.addPage([612, 792]); // US Letter
  const { width, height } = page.getSize();

  const bold   = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular= await doc.embedFont(StandardFonts.Helvetica);

  // --- Header: white band + hairline, logo, wordmark, blue pill ------------
  page.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: rgb(1, 1, 1) });
  page.drawLine({ start: { x: 0, y: height - 80 }, end: { x: width, y: height - 80 }, thickness: 0.8, color: HAIRLINE });

  let textX = 48;
  if (logoUrl) {
    try {
      const res  = await fetch(logoUrl);
      const buf  = await res.arrayBuffer();
      const img  = await doc.embedPng(buf).catch(() => doc.embedJpg(buf).catch(() => null));
      if (img) {
        const dim = img.scaleToFit(140, 40);   // keep aspect ratio, 40pt tall max
        page.drawImage(img, { x: 48, y: height - 60, width: dim.width, height: dim.height });
        textX = 48 + dim.width + 14;
      }
    } catch (_) { /* logo failed to load — text-only header */ }
  }

  page.drawText("NUTRAPACK", { x: textX, y: height - 44, size: 20, font: bold, color: INK });
  page.drawText("Packaging", { x: textX, y: height - 58, size: 9, font: regular, color: MUTED });

  // Blue pill — "PROOF"
  page.drawRectangle({ x: width - 120, y: height - 54, width: 72, height: 24, color: ACCENT });
  page.drawText("PROOF", { x: width - 105, y: height - 46, size: 11, font: bold, color: rgb(1, 1, 1) });

  // --- Main heading ---------------------------------------------------------
  page.drawText("NutraPack Proof", {
    x: 48, y: height - 130,
    size: 28, font: bold, color: INK,
  });

  // Horizontal rule
  page.drawLine({ start: { x: 48, y: height - 148 }, end: { x: width - 48, y: height - 148 }, thickness: 1, color: HAIRLINE });

  // --- Job details ----------------------------------------------------------
  const rows = [
    ["Job title",    jobTitle   || "—"],
    ["Customer",     customer   || "—"],
    ["File",         fileName   || "—"],
    ["Uploaded by",  uploadedBy || "—"],
    ["Date",         date       || new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })],
  ];

  let y = height - 188;
  for (const [lab, val] of rows) {
    page.drawText(lab, { x: 48, y, size: 10, font: regular, color: MUTED });
    page.drawText(val, { x: 180, y, size: 11, font: bold, color: INK });
    y -= 28;
  }

  // --- Notice box -----------------------------------------------------------
  y -= 16;
  page.drawRectangle({ x: 48, y: y - 52, width: width - 96, height: 66, color: rgb(0.976, 0.976, 0.969), borderColor: HAIRLINE, borderWidth: 1 });
  page.drawText("PROOF — NOT FOR PRODUCTION USE", { x: 60, y: y - 16, size: 9, font: bold, color: ACCENT });
  page.drawText("Review this proof carefully before approving. Check all text, colors, dimensions,", { x: 60, y: y - 29, size: 9, font: regular, color: MUTED });
  page.drawText("and placement. Once approved, NutraPack will proceed to production.", { x: 60, y: y - 41, size: 9, font: regular, color: MUTED });

  // --- Approval signature line ---------------------------------------------
  const sigY = 160;
  page.drawLine({ start: { x: 48, y: sigY + 30 }, end: { x: width - 48, y: sigY + 30 }, thickness: 0.5, color: HAIRLINE });
  page.drawText("APPROVAL", { x: 48, y: sigY + 40, size: 8, font: bold, color: MUTED });

  const cols = [
    { label: "Approved by (print name)", x: 48,          w: 180 },
    { label: "Signature",                x: 240,         w: 160 },
    { label: "Date",                     x: 420,         w: 110 },
    { label: "checkboxes", x: 48, w: 500 },
  ];
  let colRow = 0;
  for (const col of cols) {
    const cy = colRow < 3 ? sigY - 4 : sigY - 36;
    if (colRow === 3) {
      // Drawn checkboxes. (The "□" character isn't in the built-in PDF font —
      // it made this whole cover fail silently, so proofs uploaded without it.)
      let bx = col.x;
      for (const lab of ["Approved", "Changes required"]) {
        page.drawText(lab, { x: bx, y: cy, size: 9, font: regular, color: INK });
        bx += regular.widthOfTextAtSize(lab, 9) + 6;
        page.drawRectangle({ x: bx, y: cy - 1, width: 9, height: 9, borderColor: INK, borderWidth: 0.8 });
        bx += 30;
      }
    } else {
      page.drawLine({ start: { x: col.x, y: cy }, end: { x: col.x + col.w, y: cy }, thickness: 0.5, color: INK });
      page.drawText(col.label, { x: col.x, y: cy - 12, size: 8, font: regular, color: MUTED });
    }
    colRow++;
  }

  // Footer
  page.drawText(`Generated by NutraPack App · ${new Date().toISOString().slice(0, 10)}`, {
    x: 48, y: 32, size: 8, font: regular, color: MUTED,
  });

  return doc.save(); // returns Uint8Array
}

// Merges the cover sheet as page 1 of an existing PDF blob.
export async function mergeCoverWithPDF(coverBytes, proofBlob) {
  const proofBytes = new Uint8Array(await proofBlob.arrayBuffer());
  const coverDoc   = await PDFDocument.load(coverBytes);
  const proofDoc   = await PDFDocument.load(proofBytes);

  const merged   = await PDFDocument.create();
  const [cover]  = await merged.copyPages(coverDoc, [0]);
  merged.addPage(cover);
  const proofPages = await merged.copyPages(proofDoc, proofDoc.getPageIndices());
  proofPages.forEach((p) => merged.addPage(p));

  return merged.save();
}
