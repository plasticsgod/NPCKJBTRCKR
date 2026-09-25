// Deno-side loaders for the panel engine: pdf.js (same version as the builder) and
// optional real font files from storage (panel-files/_fonts/). Loaded lazily and
// kept for the life of the worker, so Slack's URL check and acks stay fast.
import { setFonts } from "./panel-engine-shims.js";

// Literal specifiers (not template strings) so the deploy bundler includes them.
// Keep the version in step with LIBS.pdf in panel-builder.html (3.11.174).
let pdfjsP: Promise<unknown> | null = null;

export function loadPdfjs() {
  return (pdfjsP ??= (async () => {
    // pdf.js runs its "worker" on the main thread when it finds this global (no Worker needed).
    const worker = await import("npm:pdfjs-dist@3.11.174/legacy/build/pdf.worker.js");
    (globalThis as Record<string, unknown>).pdfjsWorker = worker.default ?? worker;
    const lib = await import("npm:pdfjs-dist@3.11.174/legacy/build/pdf.js");
    return lib.default ?? lib;
  })());
}

// ---- fonts -----------------------------------------------------------------
// Drop the panel fonts (.otf/.ttf/.woff, e.g. the four Myriad Pro styles) into the
// storage folder panel-files/_fonts/ once. They're matched by PostScript name, so
// file names don't matter. Without them the engine uses Helvetica metrics, like the
// builder does in a browser that doesn't have the font.
const FONT_TTL_MS = 10 * 60 * 1000;
let fontsAt = 0;
let fontsP: Promise<string[]> | null = null;

// deno-lint-ignore no-explicit-any
export function loadFonts(db: any, bucket = "panel-files", folder = "_fonts"): Promise<string[]> {
  if (fontsP && Date.now() - fontsAt < FONT_TTL_MS) return fontsP;
  fontsAt = Date.now();
  fontsP = (async () => {
    const { data: list, error } = await db.storage.from(bucket).list(folder, { limit: 100 });
    if (error || !list?.length) { setFonts([]); return []; }
    const files = list.filter((f: { name: string }) => /\.(otf|ttf|woff)$/i.test(f.name));
    if (!files.length) { setFonts([]); return []; }
    const mod = await import("npm:opentype.js@1.3.4");
    const opentype = mod.default ?? mod;
    const loaded: { font: unknown; postScriptName: string }[] = [];
    for (const f of files) {
      try {
        const { data: blob } = await db.storage.from(bucket).download(`${folder}/${f.name}`);
        if (!blob) continue;
        const font = opentype.parse(await blob.arrayBuffer());
        const ps = font.names?.postScriptName?.en;
        if (ps) loaded.push({ font, postScriptName: ps });
      } catch (e) {
        console.error("[slack-panels] font", f.name, e);
      }
    }
    setFonts(loaded);
    return loaded.map((f) => f.postScriptName);
  })();
  return fontsP;
}
