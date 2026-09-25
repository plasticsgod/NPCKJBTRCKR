// Spec PDF → Supplement Facts panel, using the Panel Builder's own code.
// Runs the same steps as the builder's "New from spec…" screen:
//   pdfItems → buildLines/setPdfLines (template detection) → toReview → createFromImport
// and, for a revised spec in a Slack thread, the app's "Update from spec…" merge.
// Runtime-agnostic: the caller passes pdf.js (npm pdfjs-dist@3.11.174).
import { engine } from "./panel-engine.gen.js";
import { shims, fontsLoadedFor, metricsSource } from "./panel-engine-shims.js";

const E = engine;
const IMP0 = JSON.parse(JSON.stringify(E.imp));      // the import screen's starting state
let chain = Promise.resolve();                        // one conversion at a time (the builder has global state)

export class SpecError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/**
 * Read a spec PDF into a new builder project ("New from spec…").
 * @param {object} o
 * @param {Uint8Array} o.bytes      spec file
 * @param {string}     o.filename
 * @param {any}        o.pdfjs      pdf.js module (getDocument, GlobalWorkerOptions)
 */
export function importSpec(o) {
  const run = chain.then(() => doImport(o));
  chain = run.catch(() => {});
  return run;
}

async function doImport({ bytes, filename, pdfjs }) {
  shims.window.pdfjsLib = pdfjs;
  let items;
  try {
    items = await E.pdfItems(bytes.slice().buffer);          // pdf.js may take ownership of the buffer
  } catch (_e) {
    throw new SpecError("unreadable", "This PDF could not be opened.");
  }
  if (!items.length) throw new SpecError("no-text", "This PDF has no text layer (it looks like a scan or a photo).");

  // ---- from here on everything is synchronous: nothing else can touch the builder's state ----
  Object.assign(E.imp, JSON.parse(JSON.stringify(IMP0)));
  E.state.projects.length = 0; E.state.cur = 0;
  E.imp.file = { name: filename, size: bytes.length };
  E.imp.kind = "pdf";
  E.imp.items = items;
  E.setPdfLines(E.buildLines(items));
  E.toReview();
  if (!E.imp.rows.length) throw new SpecError("no-rows", "No ingredient rows were found in this PDF.");
  E.createFromImport();
  return {
    project: JSON.parse(JSON.stringify(E.P())),
    template: E.imp.detected,
    templateLabel: E.TEMPLATES[E.imp.detected].label,
    rowCount: E.imp.rows.length,
    header: JSON.parse(JSON.stringify(E.imp.header)),
  };
}

/** "Update from spec…": keep the panel's identity and look, take the formula side from the new spec. */
export const mergeSpec = (base, imported) => E.mergeImport(base, imported);

/** Checks + print files for a project, exactly as the builder exports them. Synchronous. */
export function renderPanel(project) {
  const fdef = E.fontDef(project, "body");
  E.state.loadedFonts = fontsLoadedFor(fdef) ? { [fdef.name]: true } : {};   // same as loading fonts under Style
  const L = E.layout(project);
  const flags = E.checks(project, L);
  const counts = { block: 0, warn: 0, info: 0 };
  flags.forEach((f) => counts[f.sev]++);
  return {
    flags,
    counts,
    svg: E.svgFor(project, L, { export: true }),
    pdf: E.pdfFor(project, L, project.style.showOI),
    fileBase: E.fileBase(project),
    metrics: metricsSource(fdef),
  };
}

/** Convenience: import (+ optional merge into base) + render. */
export async function convertSpec({ base = null, ...o }) {
  const imp = await importSpec(o);
  const project = base ? mergeSpec(base, imp.project) : imp.project;
  return { ...imp, project, ...renderPanel(project) };
}

// ---- what changed between two versions of a panel (for thread updates) -------
const rowKey = (r) => r.kind === "nutrient" ? "n:" + r.nk : r.kind + ":" + String(r.name || "").toLowerCase().replace(/\(.*?\)|_|\*/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const rowName = (r) => r.kind === "nutrient" ? (r.label || r.nk) + (r.source ? ` (${r.source})` : "") : String(r.name || "").replace(/\*\*|_/g, "");
const amt = (r) => r.kind === "other" ? (r.input != null ? `${+(+r.input).toFixed(2)} mg` : "—") : `${r.amt ?? "—"} ${r.unit || ""}`.trim();

export function diffRows(before, after) {
  const a = new Map((before?.rows || []).map((r) => [rowKey(r), r]));
  const b = new Map((after?.rows || []).map((r) => [rowKey(r), r]));
  const out = [];
  for (const [k, r] of b) {
    const old = a.get(k);
    if (!old) out.push(`Added ${rowName(r)} — ${amt(r)}`);
    else if (amt(old) !== amt(r)) out.push(`${rowName(r)}: ${amt(old)} → ${amt(r)}`);
  }
  for (const [k, r] of a) if (!b.has(k)) out.push(`Removed ${rowName(r)}`);
  const sa = before?.serving || {}, sb = after?.serving || {};
  if (`${sa.qty} ${sa.unit}` !== `${sb.qty} ${sb.unit}`) out.push(`Serving size: ${sa.qty} ${sa.unit} → ${sb.qty} ${sb.unit}`);
  if (String(sa.spc ?? "") !== String(sb.spc ?? "")) out.push(`Servings per container: ${sa.spc ?? "—"} → ${sb.spc ?? "—"}`);
  return out;
}
