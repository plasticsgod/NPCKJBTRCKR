// Sttark Customer API field-value reference (labels), transcribed from their docs.
// Used to build the spec dropdowns in the job form.

export const PRODUCT_TYPES = [
  { id: 1, name: "Labels" },
  { id: 2, name: "Cartons" },
];

// Label substrates (use with product_type_id = 1)
export const SUBSTRATES = [
  { id: 1, name: "White Plastic" },
  { id: 2, name: "White Plastic Removable" },
  { id: 3, name: "Clear Plastic" },
  { id: 4, name: "Ultra Clear Plastic" },
  { id: 5, name: "White Paper" },
  { id: 6, name: "Silver Metallic Paper" },
  { id: 7, name: "Silver Metallic Plastic" },
  { id: 8, name: "White Vinyl" },
  { id: 9, name: "Clear Vinyl" },
  { id: 10, name: "Estate #4 Paper" },
  { id: 11, name: "Estate #9 Paper" },
  { id: 12, name: "Recycled Paper" },
  { id: 13, name: "Terra Skin" },
  { id: 14, name: "Rainbow Hologram Plastic" },
  { id: 15, name: "Kraft Paper" },
  { id: 16, name: "Avon Classic Crest" },
  { id: 17, name: "White Paper High Tack" },
  { id: 18, name: "White Plastic Squeezable" },
  { id: 20, name: "Black Vellum" },
];

export const LAMINATES = [
  { id: 1, name: "Gloss" },
  { id: 2, name: "Matte" },
  { id: 3, name: "UV Gloss" },
  { id: 5, name: "Thermal Gloss" },
  { id: 6, name: "No Laminate" },
  { id: 7, name: "Soft Touch Matte" },
];

export const COLORS = [
  { id: 1, name: "4-Color (CMYK)" },
  { id: 2, name: "5-Color with White (CMYK+W)" },
  { id: 3, name: "Black Ink Only" },
  { id: 4, name: "Double Sided 9/C" },
  { id: 9, name: "White Ink Only" },
];

// Label shapes (use with product_type_id = 1)
export const SHAPES = [
  { id: 1, name: "Rectangle" },
  { id: 2, name: "Circle" },
  { id: 3, name: "Square" },
  { id: 4, name: "Oval" },
  { id: 5, name: "Custom" },
];

export const FORM_FACTORS = [
  { id: 1, name: "Hand Applied Sheets" },
  { id: 2, name: "Individually Cut" },
  { id: 3, name: "Rolls" },
];

export const ROLL_DIRECTIONS = [
  { id: 1, name: "Label Out Top First (LOT)" },
  { id: 2, name: "Label Out Bottom First (LOB)" },
  { id: 3, name: "Label Out Right First (LOR)" },
  { id: 4, name: "Label Out Left First (LOL)" },
];

export const PROCESSING = [
  { id: 1, name: "Standard (2 business days)" },
  { id: 2, name: "Expedited (same/next day)" },
];

export const PROOF_TYPES = [
  { id: 1, name: "No Proof" },
  { id: 2, name: "Electronic Proof" },
  { id: 3, name: "Printed Proof" },
];
