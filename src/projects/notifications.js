import { supabase } from "../supabaseClient";

// Sends a notification email via the send-notification Edge Function.
// Fails silently — a notification failure should never block the user action.
async function notify(payload) {
  try {
    const { error } = await supabase.functions.invoke("send-notification", { body: payload });
    if (error) console.warn("Notification failed:", error.message);
  } catch (err) {
    console.warn("Notification error:", err);
  }
}

// Records an in-app notification row (drives the header bell). Fails soft too —
// the email path and the in-app path are independent so one can't block the other.
async function recordInApp(row) {
  try {
    const { error } = await supabase.from("notifications").insert(row);
    if (error) console.warn("In-app notification failed:", error.message);
  } catch (err) {
    console.warn("In-app notification error:", err);
  }
}

// Call when a task is assigned to someone.
export function notifyAssignment({ to, task, project, assignedBy, taskId }) {
  if (!to || to === assignedBy) return; // don't notify yourself
  notify({ type: "assignment", to, task, project, assignedBy });
  recordInApp({ recipient: to, type: "assignment", actor: assignedBy, task, project, task_id: taskId });
}

// Call when someone @mentions people in a post or reply.
export function notifyMentions({ mentions = [], task, project, mentionedBy, body, taskId }) {
  for (const to of mentions) {
    if (to !== mentionedBy) {
      notify({ type: "mention", to, task, project, mentionedBy, body });
      recordInApp({ recipient: to, type: "mention", actor: mentionedBy, task, project, body, task_id: taskId });
    }
  }
}

// Call when someone posts a comment/reply on a task. Gives everyone ASSIGNED to
// that task an in-app heads-up ("someone commented on a task you're on"),
// skipping the author and anyone already @mentioned (they get a mention notice).
// In-app only by design, so active discussions don't flood inboxes with email.
export function notifyComment({ owners = [], author, task, project, body, mentions = [], taskId }) {
  const skip = new Set([author, ...mentions]);
  for (const to of owners) {
    if (!to || skip.has(to)) continue;
    recordInApp({ recipient: to, type: "comment", actor: author, task, project, body, task_id: taskId });
  }
}
