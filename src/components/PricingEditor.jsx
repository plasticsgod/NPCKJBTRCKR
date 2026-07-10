import { useState } from "react";
import { supabase } from "../supabaseClient";
import { unitEconomics, setEconomics, money } from "../lib/pricing";

// Deep clone so edits don't touch the active version until published.
const clone = (o) => JSON.parse(JSON.stringify(o));
const genId = () => "c" + Math.random().toString(36).slice(2, 9);

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
      if (!row) return next;
      row[key] = key === "name" ? value : value === "" ? null : Number(value);
      return next;
    });
  }
  function addProduct(group) {
    setDraft((d) => {
      const next = clone(d);
      next[group] = next[group] || [];
      next[group].push({ id: genId(), name: group === "tubs" ? "New tub" : "New lid", factory: 0, tariff: 0, pcs: null, ppp: null });
      return next;
    });
  }
  function removeProduct(group, id) {
    setDraft((d) => {
      const next = clone(d);
      next[group] = next[group].filter((x) => x.id !== id);
      if (group === "tubs" && next.sets) delete next.sets[id];
      return next;
    });
  }
  function setPairing(tubId, lidId) {
    setDraft((d) => {
      const next = clone(d);
      next.sets = next.sets || {};
      if (lidId) next.sets[tubId] = lidId; else delete next.sets[tubId];
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

  const landedOf = (item, kind) => {
    const e = kind === "set" ? setEconomics(draft, item, sh, {}) : unitEconomics(item, kind, sh, {});
    return e ? e.landed : null;
  };

  // Editable rows for tubs / lids (called inline so inputs keep focus).
  const renderGroup = (group) => (
    <div className="epx-wrap">
      <div className="epx-hdr">
        <span>Product</span><span className="r">Factory</span><span className="r">Tariff</span>
        <span className="r">Pcs/ctnr</span><span className="r">Pcs/pallet</span><span className="r">Landed</span><span></span>
      </div>
      {draft[group].map((it) => (
        <div className="epx-row" key={it.id}>
          <input className="epx-name" value={it.name} onChange={(e) => setField(group, it.id, "name", e.target.value)} />
          <input className="epx-inp" type="number" step="0.001" value={it.factory ?? ""} onChange={(e) => setField(group, it.id, "factory", e.target.value)} />
          <input className="epx-inp" type="number" step="0.001" value={it.tariff ?? ""} onChange={(e) => setField(group, it.id, "tariff", e.target.value)} />
          <input className="epx-inp" type="number" placeholder="—" value={it.pcs ?? ""} onChange={(e) => setField(group, it.id, "pcs", e.target.value)} />
          <input className="epx-inp" type="number" placeholder="—" value={it.ppp ?? ""} onChange={(e) => setField(group, it.id, "ppp", e.target.value)} />
          <span className="epx-landed">{money(landedOf(it, group === "tubs" ? "tub" : "lid"), 3)}</span>
          <button className="epx-rm" onClick={() => removeProduct(group, it.id)} aria-label={`Remove ${it.name}`}>×</button>
        </div>
      ))}
      <button className="epx-add" onClick={() => addProduct(group)}>+ Add {group === "tubs" ? "tub" : "lid"}</button>
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
                Add, remove, or edit products here. Factory &amp; tariff feed pricing; pieces-per-container
                and per-pallet enable the Containers / Pallets quantity options. Freight comes from the
                Shipping panel and folds into Landed automatically. Saving creates a new signed version —
                it never overwrites history.
              </p>

              <div className="ep-cat">Tubs</div>
              {renderGroup("tubs")}

              <div className="ep-cat">Lids</div>
              {renderGroup("lids")}

              <div className="ep-cat">Sets (tub + lid)</div>
              <div className="epx-wrap">
                <div className="epx-hdr sets"><span>Set</span><span>Paired lid</span><span className="r">Landed</span></div>
                {draft.tubs.map((t) => (
                  <div className="epx-row sets" key={"set-" + t.id}>
                    <span className="epx-name-static">{t.name.replace("Tub", "Set")}</span>
                    <select className="epx-pair" value={draft.sets?.[t.id] || ""} onChange={(e) => setPairing(t.id, e.target.value)}>
                      <option value="">— no lid —</option>
                      {draft.lids.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                    <span className="epx-landed">{landedOf(t, "set") == null ? "—" : money(landedOf(t, "set"), 3)}</span>
                  </div>
                ))}
              </div>
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
