import { useState } from "react";
import { supabase } from "../supabaseClient";

// Deep clone so edits don't mutate the active version until published.
const clone = (o) => JSON.parse(JSON.stringify(o));

export default function PricingEditor({ baseData, userEmail, onClose, onPublished }) {
  const [draft, setDraft] = useState(() => clone(baseData));
  const [label, setLabel] = useState("");
  const [signer, setSigner] = useState(userEmail || "");
  const [step, setStep] = useState("edit"); // "edit" | "signoff"
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  function setField(group, id, key, value) {
    setDraft((d) => {
      const next = clone(d);
      const arr = next[group];
      const row = arr.find((x) => x.id === id);
      if (row) row[key] = value === "" ? null : Number(value);
      return next;
    });
  }
  function setFreight(origin, port, value) {
    setDraft((d) => {
      const next = clone(d);
      next.freight[origin][port] = Number(value) || 0;
      return next;
    });
  }

  async function publish() {
    if (!label.trim()) { setMsg("Give this version a short label."); return; }
    if (!signer.trim()) { setMsg("Type a name to sign off."); return; }
    setBusy(true); setMsg("");
    const { error } = await supabase.from("pricing_versions").insert({
      version_date: new Date().toISOString().slice(0, 10),
      label: label.trim(),
      signer: signer.trim(),
      data: draft,
    });
    setBusy(false);
    if (error) { setMsg("Could not publish: " + error.message); return; }
    onPublished();
  }

  return (
    <div className="overlay">
      <div className="modal modal-wide">
        <div className="modal-head">
          <h2>{step === "edit" ? "Edit Pricing" : "Sign &amp; Publish"}</h2>
          <button className="link" onClick={onClose}>Close</button>
        </div>

        {step === "edit" ? (
          <>
            <div className="modal-body">
              <p className="muted small">
                Editing creates a new signed version — it never overwrites history. On-screen tariff
                what-ifs in the price list are separate and not published here.
              </p>

              <h3 className="card-h">Tubs — factory &amp; tariff</h3>
              <div className="edit-grid">
                {draft.tubs.map((t) => (
                  <div className="edit-row" key={t.id}>
                    <span className="edit-name">{t.name}</span>
                    <label>Factory
                      <input type="number" step="0.001" value={t.factory}
                        onChange={(e) => setField("tubs", t.id, "factory", e.target.value)} />
                    </label>
                    <label>Tariff
                      <input type="number" step="0.001" value={t.tariff}
                        onChange={(e) => setField("tubs", t.id, "tariff", e.target.value)} />
                    </label>
                  </div>
                ))}
              </div>

              <h3 className="card-h">Lids — factory &amp; tariff</h3>
              <div className="edit-grid">
                {draft.lids.map((l) => (
                  <div className="edit-row" key={l.id}>
                    <span className="edit-name">{l.name}</span>
                    <label>Factory
                      <input type="number" step="0.001" value={l.factory}
                        onChange={(e) => setField("lids", l.id, "factory", e.target.value)} />
                    </label>
                    <label>Tariff
                      <input type="number" step="0.001" value={l.tariff}
                        onChange={(e) => setField("lids", l.id, "tariff", e.target.value)} />
                    </label>
                  </div>
                ))}
              </div>

              <h3 className="card-h">Lane freight (per container)</h3>
              {["india", "china"].map((origin) => (
                <div className="edit-freight" key={origin}>
                  <span className="edit-name">{origin === "india" ? "India" : "China"}</span>
                  {Object.keys(draft.freight[origin]).map((port) => (
                    <label key={port}>{port.toUpperCase()}
                      <input type="number" value={draft.freight[origin][port]}
                        onChange={(e) => setFreight(origin, port, e.target.value)} />
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div className="modal-foot">
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn-accent" onClick={() => setStep("signoff")}>Continue to sign-off</button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body">
              <p className="muted small">
                You're publishing a new pricing version for the whole team. Add a label and confirm
                the name signing off on this change.
              </p>
              <label className="field">
                <span>Version label</span>
                <input value={label} placeholder="e.g. July freight update"
                  onChange={(e) => setLabel(e.target.value)} autoFocus />
              </label>
              <label className="field">
                <span>Signed / approved by</span>
                <input value={signer} onChange={(e) => setSigner(e.target.value)} />
              </label>
              {msg && <p className="auth-message">{msg}</p>}
            </div>
            <div className="modal-foot">
              <button className="btn-ghost" onClick={() => setStep("edit")}>Back</button>
              <button className="btn-accent" onClick={publish} disabled={busy}>
                {busy ? "Publishing…" : "Sign & publish"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
