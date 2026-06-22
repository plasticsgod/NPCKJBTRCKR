import { createClient } from "@supabase/supabase-js";

// These come from your .env file (and from Vercel's env settings once deployed).
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // A clear message beats a blank screen if the keys are missing.
  console.error(
    "Missing Supabase config. Create a .env file from .env.example and " +
      "fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
  );
}

export const supabase = createClient(url, anonKey);

// The job statuses, in pipeline order. The Board view shows one column per status.
// Edit this list to match how NutraPack actually works.
export const STATUSES = ["New", "In Design", "Printing", "Shipped", "Complete"];

// Suggested printing facilities (from your original tracker). Used in the form.
export const FACILITIES = ["PLOD", "Sttark", "Ksidrane"];
