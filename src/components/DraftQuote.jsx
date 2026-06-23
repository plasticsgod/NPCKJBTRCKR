import { money, money2 } from "../lib/pricing";

export default function DraftQuote({ quote, setQuote, onPdf }) {
  function removeLine(i) {
    setQuote((qu) => ({ ...qu, lines: qu.lines.filter((_, idx) => idx !== i) }));
  }
  const total = quote.lines.reduce((a, l) => a + l.total, 0);

  return (
    <section className="panel-card draft-panel">
      <h3 className="card-h">Draft Quote</h3>

      <label className="field">
        <span>Customer</span>
        <input
          value={quote.customer}
          placeholder="Customer name"
          onChange={(e) => setQuote((qu) => ({ ...qu, customer: e.target.value }))}
        />
      </label>

      <div className="qlines">
        {quote.lines.length === 0 ? (
          <p className="muted qempty">No lines yet. Build a quote on the left and add it here.</p>
        ) : (
          quote.lines.map((l, i) => (
            <div className="qline" key={i}>
              <span className="qn">{l.name} <small>· {l.marginLab} margin</small></span>
              <span className="num">{l.units.toLocaleString()} × {money(l.unit, 3)}</span>
              <span className="num qt2">{money2(l.total)}</span>
              <button className="qx" title="remove" onClick={() => removeLine(i)}>✕</button>
            </div>
          ))
        )}
      </div>

      <div className="qfoot">
        <span className="qtotal">Total <b>{quote.lines.length ? money2(total) : "—"}</b></span>
        <button className="btn-accent" disabled={quote.lines.length === 0} onClick={onPdf}>
          Export branded PDF
        </button>
      </div>
    </section>
  );
}
