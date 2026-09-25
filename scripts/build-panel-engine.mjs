#!/usr/bin/env node
// Builds supabase/functions/_shared/panel-engine.gen.js from public/tools/panel-builder.html.
//
// The Slack bot must produce exactly what the Panel Builder produces, so it runs the
// builder's own code. This script copies the builder's pure functions and constants
// out of the HTML *by name* (no hand copies), and wraps them with small shims for the
// browser-only bits (canvas text measurement, pdf.js loading, the import screen).
//
//   node scripts/build-panel-engine.mjs          → regenerate
//   node scripts/build-panel-engine.mjs --check  → exit 1 if the generated file is stale
//
// Run it whenever panel-builder.html changes, then redeploy the slack-panels function.
// No dependencies.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "public/tools/panel-builder.html");
const OUT = join(ROOT, "supabase/functions/_shared/panel-engine.gen.js");

// What the server needs, in dependency-safe order (constants first; function
// declarations are hoisted anyway).
const NAMES = {
  "reference data": ["MACROS", "VM", "VMK", "FONTS", "PROCESS", "CATEGORIES", "FALLBACK", "CAPSULE_MG"],
  "helpers": ["uid", "esc", "num", "trim", "toMg", "inDvUnit", "roundTo", "baseText", "baseStyle", "baseMacros", "R", "blankProject", "P"],
  "text": ["fontDef", "measureSegs", "parseMarkup", "plain", "wrapSegs"],
  "rules": ["roundMacro", "roundNaK", "pctText", "amtStr", "childrenOf", "groupSumMg", "fmtTotal", "parseAmt",
            "computePanel", "otherIngredients", "suggestedUse", "totalCaffeine"],
  "panel": ["layout", "checks"],
  "output": ["svgFor", "WIN", "WIN_REV", "winAnsiCode", "pdfStr", "pdfFor", "fileBase"],
  "import": ["imp", "pdfItems", "buildLines", "numv", "firstMatch", "block", "TEMPLATES",
             "NUT_RE", "OTHER_RE", "NOT_BOTANICAL", "titleFirst", "classify", "prepRows",
             "normName", "setPdfLines", "toReview", "createFromImport"],
  "app bridge (Update from spec…)": ["clone", "mergeImport"],
};

// ---------------------------------------------------------------------------
// A small JS scanner: enough to find where a declaration ends while skipping
// strings, template literals, comments and regex literals.
const REGEX_AFTER_WORD = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);

function skipString(s, i) {                 // s[i] is ' or "
  const q = s[i++];
  while (i < s.length) { const c = s[i]; if (c === "\\") { i += 2; continue; } if (c === q) return i + 1; if (c === "\n") throw new Error("unterminated string"); i++; }
  throw new Error("unterminated string");
}
function skipTemplate(s, i) {               // s[i] is `
  i++;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "`") return i + 1;
    if (c === "$" && s[i + 1] === "{") { i = scanBalanced(s, i + 1); continue; }
    i++;
  }
  throw new Error("unterminated template");
}
function skipRegex(s, i) {                  // s[i] is /
  i++; let cls = false;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "\n") throw new Error("unterminated regex");
    if (cls) { if (c === "]") cls = false; }
    else if (c === "[") cls = true;
    else if (c === "/") { i++; while (/[a-z]/i.test(s[i] || "")) i++; return i; }
    i++;
  }
  throw new Error("unterminated regex");
}
// Walk code from i, calling visit(ch, i, depth) for each significant char outside
// strings/comments/regexes. visit returns a number to stop (that index is returned).
function walk(s, i, visit) {
  let depth = 0, prev = "";                 // prev: last significant token kind/char
  while (i < s.length) {
    const c = s[i];
    if (c === "/" && s[i + 1] === "/") { i = s.indexOf("\n", i); if (i < 0) return s.length; continue; }
    if (c === "/" && s[i + 1] === "*") { i = s.indexOf("*/", i + 2) + 2; continue; }
    if (c === "'" || c === '"') { i = skipString(s, i); prev = "v"; continue; }
    if (c === "`") { i = skipTemplate(s, i); prev = "v"; continue; }
    if (c === "/") {
      const isRegex = prev === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || REGEX_AFTER_WORD.has(prev);
      if (isRegex) { i = skipRegex(s, i); prev = "v"; continue; }
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i; while (/[\w$]/.test(s[j] || "")) j++;
      const word = s.slice(i, j);
      const r = visit(word, i, depth); if (r != null) return r;
      prev = REGEX_AFTER_WORD.has(word) ? word : "v"; i = j; continue;
    }
    if (/[0-9]/.test(c)) { let j = i; while (/[\w.]/.test(s[j] || "")) j++; prev = "v"; i = j; continue; }
    if (/\s/.test(c)) { const r = visit(c, i, depth); if (r != null) return r; i++; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    const r = visit(c, i, depth); if (r != null) return r;
    if (c === ")" || c === "]" || c === "}") depth--;
    prev = (c === ")" || c === "]") ? "v" : c;
    i++;
  }
  return s.length;
}
function scanBalanced(s, i) {               // s[i] is an opener; returns index after its closer
  const start = i;
  // closers are reported before the depth drops, so the matching one is seen at depth 1
  return walk(s, i, (ch, at, depth) => (at > start && depth === 1 && /[)\]}]/.test(ch)) ? at + 1 : null);
}

// Find the full source text of `function NAME(...) {...}` or `const|let|var NAME = ...;`
function extract(code, name) {
  const fnRe = new RegExp(`(^|[^\\w$.])((?:async\\s+)?function\\s*\\*?\\s*${name}\\s*\\()`, "g");
  const varRe = new RegExp(`(^|[^\\w$.])((?:const|let|var)\\s+${name}\\s*=)`, "g");
  const hits = [];
  for (const [re, kind] of [[fnRe, "fn"], [varRe, "var"]]) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(code))) hits.push({ at: m.index + m[1].length, kind, head: m[2] });
  }
  // Ignore matches inside strings/comments: keep only positions the scanner visits.
  let real = [];
  const want = new Set(hits.map((h) => h.at));
  walk(code, 0, (tok, at, depth) => { if (want.has(at)) real.push({ ...hits.find((h) => h.at === at), depth }); return null; });
  if (real.length === 0) throw new Error(`"${name}" not found in panel-builder.html`);
  // Same name declared in several scopes (e.g. a local "var imp" in the bridge): the top-level one wins.
  if (real.length > 1) real = real.filter((h) => h.depth === 0);
  if (real.length !== 1) throw new Error(`"${name}" is declared more than once at the top level of panel-builder.html`);
  const h = real[0];
  if (h.kind === "fn") {
    const open = code.indexOf("(", h.at + h.head.length - 1);
    const afterParams = scanBalanced(code, open);
    const brace = code.slice(afterParams).search(/\S/) + afterParams;
    if (code[brace] !== "{") throw new Error(`"${name}": expected a function body`);
    return code.slice(h.at, scanBalanced(code, brace));
  }
  // variable: ends at the first ';' at depth 0, or a newline at depth 0 that isn't continued
  const eq = h.at + h.head.length;
  const end = walk(code, eq, (ch, at, depth) => {
    if (depth !== 0) return null;
    if (ch === ";") return at + 1;
    if (ch === "\n") { const rest = code.slice(at + 1).match(/^\s*(\S)/); if (rest && !/[.?:+\-*/%&|,)\]}=<>]/.test(rest[1])) return at; }
    if (/[)\]}]/.test(ch)) return at;       // closing an outer scope
    return null;
  });
  let text = code.slice(h.at, end).trimEnd();
  if (!text.endsWith(";")) text += ";";
  return text;
}

// ---------------------------------------------------------------------------
const html = readFileSync(SRC, "utf8");
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
const code = scripts.join("\n;\n");
const srcHash = createHash("sha256").update(html).digest("hex").slice(0, 16);

// pdf.js must be the same version on both sides (text extraction feeds the parser).
const RUNTIME = join(ROOT, "supabase/functions/_shared/panel-runtime.ts");
const builderVers = [...new Set([...html.matchAll(/pdf\.js\/(\d+\.\d+\.\d+)\//g)].map((m) => m[1]))];
const builderPdfjs = builderVers.length === 1 ? builderVers[0] : null;
const serverPdfjs = [...readFileSync(RUNTIME, "utf8").matchAll(/pdfjs-dist@(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
if (!builderPdfjs || !serverPdfjs.length || serverPdfjs.some((v) => v !== builderPdfjs)) {
  console.error(`pdf.js version mismatch: builder ${builderVers.join("/")}, server ${[...new Set(serverPdfjs)].join("/")} — update panel-runtime.ts.`);
  process.exit(1);
}

let body = "";
for (const [section, names] of Object.entries(NAMES)) {
  body += `\n/* ---------- ${section} ---------- */\n`;
  for (const n of names) body += extract(code, n) + "\n";
}

const out = `// GENERATED by scripts/build-panel-engine.mjs from public/tools/panel-builder.html
// (source sha256 ${srcHash}). Do not edit: change the builder, then re-run the script.
/* eslint-disable */
// @ts-nocheck
import { shims } from "./panel-engine-shims.js";
const { state, window, LIBS, needLib, renderImport, renderAll, closeImport, toast, fontAvailable, measure, loadProfiles } = shims;
${body}
/* ---------- exports ---------- */
export const engine = {
  state, imp, P, pdfItems, buildLines, setPdfLines, toReview, createFromImport, TEMPLATES,
  layout, checks, svgFor, pdfFor, fileBase, mergeImport, blankProject, baseText, baseStyle, fontDef, FONTS,
};
export const SOURCE_HASH = ${JSON.stringify(srcHash)};
`;

if (process.argv.includes("--check")) {
  const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (cur !== out) { console.error("panel-engine.gen.js is out of date — run: node scripts/build-panel-engine.mjs"); process.exit(1); }
  console.log("panel-engine.gen.js is up to date.");
} else {
  writeFileSync(OUT, out);
  const count = Object.values(NAMES).flat().length;
  console.log(`Wrote ${OUT.replace(ROOT + "/", "")} — ${count} declarations from panel-builder.html (sha ${srcHash}).`);
}
