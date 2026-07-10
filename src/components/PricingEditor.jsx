import { useState } from "react";
import { supabase } from "../supabaseClient";
import { unitEconomics, setEconomics, money } from "../lib/pricing";

// Deep clone so edits don't touch the active version until published.
const clone = (o) => JSON.parse(JSON.stringify(o));

export default function PricingEditor({ baseData, ship, userEmail, onClose, onPublished }) {
  const [draft, setDraft] = useState(() => clone(baseData));
  const [label, setLabel] = useState("");
  const [signer, setSigner] = useState(userEmail || "");
  const [step, setStep] = useState("edit"); // "edit" | "signoff"
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const sh = ship || { freight: 0, portc: 0, truck: 0, ware: 0 };

  function setField(group, id, key, value) {
    setDraft((d) => {
      const next = clone(d);
      const row = next[group].find((x) => x.id === id);
      if (row) row[key] = value === "" ? 0 : Number(value);
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

  // Landed reflects the current shipping inputs, folded in automatically.
  const tubLanded = (t) => unitEconomics(t, "tub", sh, {}).landed;
  const lidLanded = (l) => unitEconomics(l, "lid", sh, {}).landed;
  const setLanded = (t) => setEconomics(draft, t, sh, {}).landed;

  const Header = () => (
    <div className="ep-hdr">
      <span>Item</span><span className="r">Factory</span><span className="r">Tariff</span><span className="r">Landed</span>
    </div>
  );

  return (
    <div className="overlay">
      <div className="modal modal-wide">
        <div className="modal-head">
          <h2>{step === "edit" ? "Edit pricing" : "Sign & publish"}</h2>
          <button className="link" onClick={onClose}>Close</button>
        </div>

        {step === "edit" ? (
          <>
            <div className="modal-body">
              <p className="ep-note">
                Set factory cost &amp; tariff per item. Freight comes from the Shipping panel and is folded
                into Landed automatically. Saving creates a new signed version — it never overwrites history.
              </p>

              <div className="ep-cat">Tubs</div>
              <Header />
              {draft.tubs.map((t) => (
                <div className="ep-row" key={t.id}>
                  <span className="ep-iname">{t.name}</span>
                  <input className="ep-inp" type="number" step="0.001" value={t.factory}
                    onChange={(e) => setField("tubs", t.id, "factory", e.target.value)} />
                  <input className="ep-inp" type="number" step="0.001" value={t.tariff}
                    onChange={(e) => setField("tubs", t.id, "tariff", e.target.value)} />
                  <span className="ep-landed">{money(tubLanded(t), 3)}<small>incl. freight</small></span>
                </div>
              ))}

              <div className="ep-cat">Lids</div>
              <Header />
              {draft.lids.map((l) => (
                <div className="ep-row" key={l.id}>
                  <span className="ep-iname">{l.name}</span>
                  <input className="ep-inp" type="number" step="0.001" value={l.factory}
                    onChange={(e) => setField("lids", l.id, "factory", e.target.value)} />
                  <input className="ep-inp" type="number" step="0.001" value={l.tariff}
                    onChange={(e) => setField("lids", l.id, "tariff", e.target.value)} />
                  <span className="ep-landed">{money(lidLanded(l), 3)}<small>no freight add-on</small></span>
                </div>
              ))}

              <div className="ep-cat">Sets (tub + lid)</div>
              <Header />
              {draft.tubs.map((t) => (
                <div className="ep-row" key={"set-" + t.id}>
                  <span className="ep-iname">{t.name.replace("Tub", "Set")} + lid</span>
                  <span className="ep-calc">tub + lid</span>
                  <span className="ep-calc">—</span>
                  <span className="ep-landed">{money(setLanded(t), 3)}<small>{t.name} + lid</small></span>
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
