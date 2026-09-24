// Quick quote math — shared by the builder and the PDF so they always agree.
import { MARGINS } from "./pricing";

export const BUILTIN = ["Packaging", "Services", "Discount", "Shipping"];
export const kindOf = (l) => (BUILTIN.includes(l.item) ? l.item.toLowerCase() : "item");
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// Packaging sell price per unit from cost + margin (margin on sell price,
// same formula as the estimator: 50% -> cost / 0.5).
export function packagingUnit(l) {
  const c = num(l.cost);
  if (c == null) return null;
  let d;
  if (l.mIdx === "custom") {
    const m = num(l.customM);
    if (m == null || m < 0 || m >= 100) return null;
    d = 1 - m / 100;
  } else {
    d = (MARGINS[l.mIdx ?? 0] || MARGINS[0]).d;
  }
  return c / d;
}

// Returns { rows: [{ line, kind, unit, amount }], sub, discount, shipping, total }
export function computeQuote(lines = []) {
  const rows = lines.map((l) => ({ line: l, kind: kindOf(l), unit: null, amount: null }));
  let sub = 0;
  for (const r of rows) {
    const l = r.line;
    if (r.kind === "item" || r.kind === "services") {
      r.unit = num(l.price);
      const q = num(l.qty);
      r.amount = r.unit == null ? null : q == null ? r.unit : r.unit * q;
    } else if (r.kind === "packaging") {
      r.unit = packagingUnit(l);
      const q = num(l.qty);
      r.amount = r.unit == null ? null : q == null ? r.unit : r.unit * q;
    }
    if (["item", "services", "packaging"].includes(r.kind) && r.amount != null) sub += r.amount;
  }
  let discount = 0, shipping = 0;
  for (const r of rows) {
    const l = r.line;
    if (r.kind === "discount") {
      const v = num(l.value);
      r.amount = v == null ? null : -(l.mode === "flat" ? v : (sub * v) / 100);
      discount += r.amount || 0;
    }
    if (r.kind === "shipping") {
      r.amount = num(l.price);
      shipping += r.amount || 0;
    }
  }
  const round = (n) => Math.round(n * 100) / 100;
  return { rows, sub: round(sub), discount: round(discount), shipping: round(shipping), total: round(sub + discount + shipping) };
}

export const money = (n, dp = 2) =>
  n == null || Number.isNaN(n) ? "—" :
  (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
