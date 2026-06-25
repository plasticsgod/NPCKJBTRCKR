// Display name map: email -> name shown in UI.
// Add new team members here as they join.
export const USER_NAMES = {
  "eduardonutramedia@gmail.com": "Eduardo",
  "jeff.weisser@nutrapack.co":   "Jeff",
  "taylor.know@nutrapack.co":    "TK",
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

// --- Per-person avatar colors ------------------------------------------------
// Each person gets their own consistent color everywhere avatars appear, so
// teammates are easy to tell apart at a glance. Known teammates get fixed,
// well-separated hues; anyone else gets a stable hue derived from their email.
const KNOWN_HUES = {
  "eduardonutramedia@gmail.com": 262, // violet
  "jeff.weisser@nutrapack.co":   202, // blue
  "taylor.know@nutrapack.co":    145, // green
  "taylor.knox@nutrapack.co":    145, // green
  "cc@nutramedia.co":            344, // rose
};

function hueFor(email) {
  if (KNOWN_HUES[email] != null) return KNOWN_HUES[email];
  // Deterministic hash of the email -> hue 0..359 (stable across sessions).
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) % 360;
  return h;
}

// Returns the {background, color} for a person's avatar — a soft tinted circle
// with readable same-hue ink, matching the app's original avatar look.
export function avatarStyle(email) {
  if (!email) return { background: "#CECBF6", color: "#3C3489" };
  const h = hueFor(email);
  return { background: `hsl(${h} 68% 88%)`, color: `hsl(${h} 52% 36%)` };
}
