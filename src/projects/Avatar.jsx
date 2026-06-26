import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { displayName, nameInitials, avatarStyle } from "./userMap";

// Avatar circle that shows a small "who is this" card on hover (full name +
// email). The card is rendered through a portal to document.body so it's never
// clipped by scrollable containers like the projects table.
export default function Avatar({ email, size = "", className = "" }) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.bottom + 78 < window.innerHeight;
    setPos({ x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
  }
  function hide() { setPos(null); }

  const cls = "avatar" + (size ? " " + size : "") + (className ? " " + className : "");

  return (
    <span
      ref={ref}
      className={cls}
      style={avatarStyle(email)}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {nameInitials(email)}
      {pos && createPortal(
        <span
          className="avatar-card"
          style={{
            left: pos.x,
            top: pos.y,
            transform: "translateX(-50%)" + (pos.below ? "" : " translateY(-100%)"),
          }}
        >
          <span className="avatar-card-pic" style={avatarStyle(email)}>{nameInitials(email)}</span>
          <span className="avatar-card-text">
            <span className="avatar-card-name">{displayName(email)}</span>
            <span className="avatar-card-email">{email}</span>
          </span>
        </span>,
        document.body
      )}
    </span>
  );
}
