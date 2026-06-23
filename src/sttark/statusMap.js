// Maps Sttark's order statuses onto NutraPack's work-order statuses.
// Used to auto-update a linked job's status from its Sttark order.

export const STTARK_TO_NUTRAPACK = {
  "Saved Quote": "Not Submitted",
  "Preprinting": "Printing",
  "Printing": "Printing",
  "Laminating": "Printing",
  "Converting": "Printing",
  "Waiting on Customer": "Waiting for proofs and approval",
  "Shipping": "Shipped",
  "Complete": "Delivered",
};

// Returns the NutraPack status for a given Sttark status label, or null if
// there's no mapping (in which case we leave the job's status untouched).
export function mapSttarkStatus(sttarkLabel) {
  if (!sttarkLabel) return null;
  return STTARK_TO_NUTRAPACK[sttarkLabel] ?? null;
}
