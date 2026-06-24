// Display name map: email -> name shown in UI.
// Add new team members here as they join.
export const USER_NAMES = {
  "eduardonutramedia@gmail.com": "Eduardo",
  "jeff.weisser@nutrapack.co":   "Jeff",
  "taylor.knox@nutrapack.co":    "TK",
  "cc@nutramedia.co":            "Christina",
};

// Get display name for an email, fall back to email if not in map.
export function displayName(email) {
  if (!email) return "";
  return USER_NAMES[email] || email;
}

// Get initials from display name or email.
export function nameInitials(email) {
  if (!email) return "?";
  const name = USER_NAMES[email];
  if (name) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || name[0].toUpperCase();
  }
  // Fall back to email-based initials
  const parts = email.replace(/@.*/, "").split(/[.\s_]+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || email[0].toUpperCase();
}
