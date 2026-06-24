export const TASK_STATUSES = ["To do", "In progress", "Stuck", "Done"];
export const statusClass = (s) => "tpill tpill-" + (s || "to-do").toLowerCase().replace(/\s+/g, "-");
