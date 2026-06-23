// Pricing math — ported verbatim from the original tool. Pure functions, no UI.
// landed = factory + add-on + tariff; add-on = container costs / pcs (TUBS ONLY).
// sells = landed / divisor, divisors 0.5/0.6/0.7 for 50/40/30% margin.

export const MARGINS = [
  { lab: "50%", d: 0.5 },
  { lab: "40%", d: 0.6 },
  { lab: "30%", d: 0.7 },
];

export const ORIGINS = [
  { id: "india", name: "India — Mumbai (Nhava Sheva)" },
  { id: "china", name: "China — Ningbo / Shanghai" },
];

export const PORTS = [
  { id: "lalb", name: "Los Angeles / Long Beach", coast: "USWC" },
  { id: "sea", name: "Seattle / Tacoma", coast: "USWC" },
  { id: "hou", name: "Houston", coast: "GULF" },
  { id: "sav", name: "Savannah", coast: "USEC" },
  { id: "nynj", name: "New York / New Jersey", coast: "USEC" },
];

export function fbxLane(originId, coast) {
  if (originId === "china" && coast === "USWC") return { code: "FBX01", name: "China/E.Asia → US West Coast" };
  if (originId === "china" && coast === "USEC") return { code: "FBX03", name: "China/E.Asia → US East Coast" };
  if (originId === "china" && coast === "GULF") return { code: "FBX03", name: "China → US East Coast (proxy for Gulf)" };
  return null;
}

export const SAMPLE_MARKET = { updated: "sample — not live", lanes: { FBX01: 2400, FBX03: 3850 } };

// --- core economics ---------------------------------------------------------
export function containerCosts(ship) {
  return (ship.freight || 0) + (ship.portc || 0) + (ship.truck || 0) + (ship.ware || 0);
}

export function findItem(data, id) {
  return [...data.tubs, ...data.lids].find((x) => x.id === id);
}

// tariffOverrides: { [id]: number } from on-screen edits; falls back to item.tariff
export function unitEconomics(item, kind, ship, tariffOverrides) {
  const ad = kind === "tub" || (kind === "custom" && item.pcs) ? containerCosts(ship) / item.pcs : 0;
  const t = kind === "custom" ? item.tariff : tariffOverrides?.[item.id] ?? item.tariff ?? 0;
  const landed = item.factory + ad + t;
  return { addOn: ad, tariff: t, landed, sells: MARGINS.map((m) => landed / m.d) };
}

export function setEconomics(data, tub, ship, tariffOverrides) {
  const lid = findItem(data, data.sets[tub.id]);
  const t = unitEconomics(tub, "tub", ship, tariffOverrides);
  const l = unitEconomics(lid, "lid", ship, tariffOverrides);
  const landed = t.landed + l.landed;
  return { lid, landed, sells: MARGINS.map((m) => landed / m.d) };
}

export function unitsFromQty(item, mode, qty) {
  if (mode === "units") return qty;
  if (mode === "pallets") return item.ppp ? qty * item.ppp : null;
  return item.pcs ? qty * item.pcs : null;
}

// --- formatting (matches original money/money2) -----------------------------
export const money = (n, d = 4) =>
  n == null || isNaN(n) ? "—" : "$" + n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const money2 = (n) =>
  n == null || isNaN(n) ? "—" : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
