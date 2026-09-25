// Stand-ins for the browser-only parts of panel-builder.html, so its own code
// (panel-engine.gen.js) can run on the server. Hand-written, kept small on purpose.
//
//   measure()        canvas measureText → font metrics (real font files if loaded, else Helvetica AFM)
//   window.pdfjsLib  the npm pdf.js (same version as the builder: 3.11.174), set by the caller
//   state            the builder's app state (only projects/cur/loadedFonts matter here)
//   UI functions     no-ops (renderImport, renderAll, closeImport, toast)
import { HELVETICA } from "./helvetica-afm.js";

// Browsers give control characters and "default ignorable" ones (soft hyphen,
// zero-width space…) no width; do the same.
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2060\uFEFF]/gu;
const styleKey = (seg) => (seg.b && seg.i ? "bi" : seg.b ? "b" : seg.i ? "i" : "r");

// ---- metrics ---------------------------------------------------------------
// Widths are in em (multiply by the point size). Kerning is applied like the
// browser's canvas measureText (Chrome/Safari kern by default).
function afmWidth(key, text) {
  const m = HELVETICA[key];
  let w = 0, prev = "";
  for (const ch of text.replace(INVISIBLE, "")) {
    w += m.w[ch.codePointAt(0)] ?? 556;
    if (prev) w += m.k[prev + ch] ?? 0;
    prev = ch;
  }
  return w / 1000;
}

// Real font files (opentype.js Font objects). opentype.js's own kerning skips
// GPOS class-based pairs, so pair kerning is read from GPOS here, the way the
// browser's shaper applies it (latn/DFLT "kern" lookups, first matching subtable).
const fonts = new Map();                     // PostScript name → {font, kern}
const cache = new Map();

const covIndex = (cov, g) => {
  if (cov.format === 1) return cov.glyphs.indexOf(g);
  for (const r of cov.ranges) if (g >= r.start && g <= r.end) return r.index + g - r.start;
  return -1;
};
const classOf = (cd, g) => {
  if (!cd) return 0;
  if (cd.format === 1) { const i = g - cd.startGlyph; return i >= 0 && i < cd.classes.length ? cd.classes[i] : 0; }
  for (const r of cd.ranges) if (g >= r.start && g <= r.end) return r.classId;
  return 0;
};
function gposKerner(font) {
  const gpos = font.tables.gpos;
  if (!gpos) {                               // legacy 'kern' table only
    return (a, b) => (font.kerningPairs && font.kerningPairs[a + "," + b]) || 0;
  }
  const script = (gpos.scripts.find((s) => s.tag === "latn") || gpos.scripts.find((s) => s.tag === "DFLT") || gpos.scripts[0])?.script;
  const featIdx = script?.defaultLangSys?.featureIndexes || [];
  const lookupIdx = [...new Set(featIdx.filter((i) => gpos.features[i]?.tag === "kern").flatMap((i) => gpos.features[i].feature.lookupListIndexes))].sort((x, y) => x - y);
  const subtables = lookupIdx.map((i) => {
    const l = gpos.lookups[i];
    const subs = l.lookupType === 9 ? l.subtables.filter((s) => s.extensionLookupType === 2).map((s) => s.extension) : l.lookupType === 2 ? l.subtables : [];
    return subs;
  }).filter((s) => s.length);
  return (a, b) => {
    let total = 0;
    for (const subs of subtables) {
      for (const st of subs) {
        const ci = covIndex(st.coverage, a);
        if (ci < 0) continue;
        if (st.posFormat === 1) {
          const pair = (st.pairSets[ci] || []).find((p) => p.secondGlyph === b);
          if (pair) { total += pair.value1?.xAdvance || 0; break; }
        } else if (st.posFormat === 2) {
          const rec = st.classRecords[classOf(st.classDef1, a)]?.[classOf(st.classDef2, b)];
          if (rec) { total += rec.value1?.xAdvance || 0; break; }  // format 2 covers every pair in coverage
        }
      }
    }
    return total;
  };
}
function fontWidth(entry, text) {
  const { font, kern } = entry;
  const glyphs = font.stringToGlyphs(text.replace(INVISIBLE, ""));
  let w = 0;
  for (let i = 0; i < glyphs.length; i++) {
    w += glyphs[i].advanceWidth || 0;
    if (i) w += kern(glyphs[i - 1].index, glyphs[i].index);
  }
  return w / font.unitsPerEm;
}

export function setFonts(list) {             // [{font, postScriptName}]
  fonts.clear(); cache.clear();
  for (const f of list || []) fonts.set(f.postScriptName, { font: f.font, kern: gposKerner(f.font) });
}
export function fontsLoadedFor(fdef) {       // true when every style of this family has a real file
  return ["r", "b", "i", "bi"].every((k) => fonts.has(fdef.ps[k]));
}
export function metricsSource(fdef) {
  return fontsLoadedFor(fdef) ? `${fdef.name} (font files)` : ["r", "b"].some((k) => fonts.has(fdef.ps[k])) ? `${fdef.name} (partial font files, Helvetica for the rest)` : "Helvetica fallback metrics";
}

function measure(f, seg, size) {
  const key = styleKey(seg);
  const ps = f.ps[key];
  const ck = ps + "|" + key + "|" + seg.text;
  let w = cache.get(ck);
  if (w == null) {
    const font = fonts.get(ps);
    w = font ? fontWidth(font, seg.text) : afmWidth(key, seg.text);
    cache.set(ck, w);
  }
  return w * size;
}

// ---- the builder's globals ---------------------------------------------------
const state = { projects: [], cur: 0, tab: "formula", open: null, overlay: false, zoom: 1, loadedFonts: {} };

export const shims = {
  state,
  window: { pdfjsLib: null },
  LIBS: { pdf: [""], xlsx: [] },
  needLib: async () => {},
  renderImport() {}, renderAll() {}, closeImport() {}, toast() {},
  fontAvailable: () => false,                // installed-font probe → we only know about loaded files
  measure,
  loadProfiles: () => ({}),                  // spreadsheet profiles live in the browser (see handoff step 4)
};
