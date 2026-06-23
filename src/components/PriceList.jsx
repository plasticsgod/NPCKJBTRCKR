import { unitEconomics, setEconomics, money, money2 } from "../lib/pricing";

export default function PriceList({ data, ship, ov, setTariffOv }) {
  const tubRow = (item, kind) => {
    const e = unitEconomics(item, kind, ship, ov);
    const full = item.pcs ? e.sells[0] * item.pcs : null;
    return (
      <tr key={kind + item.id}>
        <td>{item.name}</td>
        <td className="num">{item.pcs ? item.pcs.toLocaleString() : "—"}</td>
        <td className="num">{money(item.factory)}</td>
        <td className="num">{money(e.addOn)}</td>
        <td className="num">
          {kind === "lid" ? (
            <em className="muted" title="included in pricing">included</em>
          ) : (
            <input
              className="tar-inp num"
              type="number"
              step="0.001"
              value={ov[item.id]}
              onChange={(e2) => setTariffOv((o) => ({ ...o, [item.id]: parseFloat(e2.target.value) || 0 }))}
            />
          )}
        </td>
        <td className="num">{money(e.landed)}</td>
        <td className="num hero-col">{money(e.sells[0], 3)}</td>
        <td className="num">{money(e.sells[1], 3)}</td>
        <td className="num">{money(e.sells[2], 3)}</td>
        <td className="num">{money2(full)}</td>
      </tr>
    );
  };

  return (
    <section className="panel-card price-list">
      <h3 className="card-h">Live Price List <span className="muted small">· tariff cells are editable what-ifs (not saved)</span></h3>
      <div className="table-wrap">
        <table className="table price-table">
          <thead>
            <tr>
              <th>Item</th><th className="num">Pcs / container</th><th className="num">Factory</th>
              <th className="num">Add-on</th><th className="num">Tariff</th><th className="num">Landed</th>
              <th className="num">50%</th><th className="num">40%</th><th className="num">30%</th>
              <th className="num">Full container @ 50%</th>
            </tr>
          </thead>
          <tbody>
            <tr className="grouprow"><td colSpan={10}>Tubs — India</td></tr>
            {data.tubs.map((t) => tubRow(t, "tub"))}
            <tr className="grouprow"><td colSpan={10}>Lids — China</td></tr>
            {data.lids.map((l) => tubRow(l, "lid"))}
            <tr className="grouprow"><td colSpan={10}>Sets — Tub + Lid</td></tr>
            {data.tubs.map((t) => {
              const e = setEconomics(data, t, ship, ov);
              return (
                <tr key={"set" + t.id}>
                  <td>{t.name.replace("Tub", "Set")} <span className="muted">+ {data.sets[t.id]}</span></td>
                  <td className="num">—</td>
                  <td className="num">{money(t.factory + e.lid.factory)}</td>
                  <td className="num">{money(unitEconomics(t, "tub", ship, ov).addOn)}</td>
                  <td className="num muted">{money((ov[t.id] || 0) + (ov[e.lid.id] || 0))}</td>
                  <td className="num">{money(e.landed)}</td>
                  <td className="num hero-col">{money(e.sells[0], 3)}</td>
                  <td className="num">{money(e.sells[1], 3)}</td>
                  <td className="num">{money(e.sells[2], 3)}</td>
                  <td className="num">—</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
