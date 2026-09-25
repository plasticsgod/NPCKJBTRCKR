// Turns the builder's checks into what the team needs in Slack:
//   questions  → things only the co-man can answer (numbered, blocking first)
//   beforePrint → things NutraPack finishes in Panel Builder
// Plain text (no Slack markup) so it can be copied into an email to the co-man.

const LATIN_NOTE = /\s*Add the Latin name \(_italic_\) and plant part\.?/g;
const clean = (s) => String(s || "").replace(LATIN_NOTE, "").replace(/_([^_]+)_/g, "$1").replace(/\s+/g, " ").trim();
const rowLabel = (r) => r ? (r.kind === "nutrient" ? (r.label || r.nk) : String(r.name || "").replace(/\*\*|_/g, "")) : "";

// Internal items: Panel Builder settings and our own review, not co-man questions.
const INTERNAL_SRC = new Set(["Package", "Type size", "Print", "Allergens", "Text", "Liberty", "Rounding", "Export", "Font", "Panel", "Callouts", "Trademark"]);

export function panelQuestions(project, flags) {
  const rows = new Map((project.rows || []).map((r) => [r.id, r]));
  const questions = [];         // {text, block}
  const beforePrint = [];
  const botanical = new Map();  // rowId → {latin, part}
  const rowsAsked = new Set();

  for (const f of flags) {
    if (f.sev === "info") continue;
    const r = f.rowId ? rows.get(f.rowId) : null;

    if (f.src === "Botanical" && r) {
      const b = botanical.get(r.id) || { latin: false, part: false };
      if (/Latin name/i.test(f.msg)) b.latin = true;
      if (/plant part/i.test(f.msg)) b.part = true;
      botanical.set(r.id, b);
      continue;
    }
    if (f.src === "Data" && r && rowsAsked.has(r.id)) continue;           // already asked about this row
    if (INTERNAL_SRC.has(f.src) && f.sev !== "block") { beforePrint.push(clean(f.msg)); continue; }

    if (r) {
      const note = clean(f.src === "Reviewer note" ? f.det : `${f.msg}. ${f.det || ""}`);
      if (!note) continue;                                               // was only the Latin-name reminder
      questions.push({ block: f.sev === "block", text: `${rowLabel(r)}: ${note}` });
      rowsAsked.add(r.id);
    } else {
      const det = clean(f.det);
      questions.push({ block: f.sev === "block", text: det ? `${clean(f.msg)} — ${det}` : clean(f.msg) });
    }
  }

  if (botanical.size) {
    const both = [], latin = [], part = [];
    for (const [id, b] of botanical) {
      const n = rowLabel(rows.get(id));
      (b.latin && b.part ? both : b.latin ? latin : part).push(n);
    }
    const parts = [];
    if (both.length) parts.push(`Latin name and plant part for ${both.join(", ")}`);
    if (latin.length) parts.push(`Latin name for ${latin.join(", ")}`);
    if (part.length) parts.push(`plant part for ${part.join(", ")}`);
    const s = parts.join("; ");
    questions.push({ block: false, text: s[0].toUpperCase() + s.slice(1) + "." });
  }

  questions.sort((a, b) => Number(b.block) - Number(a.block));
  return { questions, beforePrint: [...new Set(beforePrint)] };
}
