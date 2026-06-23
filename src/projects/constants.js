// Shared constants for the Projects tracker.

export const TASK_STATUSES = ["To do", "In progress", "Stuck", "Done"];
export const TASK_PRIORITIES = ["Low", "Medium", "High", "Urgent"];

// Pill color classes (defined in index.css) keyed by status/priority.
export const statusClass = (s) => "tpill tpill-" + (s || "").toLowerCase().replace(/\s+/g, "-");
export const priorityClass = (p) => "ppill ppill-" + (p || "").toLowerCase();
