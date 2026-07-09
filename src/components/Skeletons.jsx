// Loading skeletons — gray placeholders shaped like each page's real content,
// so the swap to real data is seamless (no layout jump). Shown only while data
// is loading; reuses the real layout classes (.toolbar, .table-wrap, .proj-head,
// .stat-grid, etc.) so sizes match.

function Bar({ w, h = 12, r = 4, ...rest }) {
  return <span className="sk" style={{ width: w, height: h, borderRadius: r, ...rest }} />;
}

export function WorkOrdersSkeleton() {
  return (
    <>
      <div className="toolbar">
        <Bar w={240} h={38} r={8} />
        <Bar w={70} h={14} />
        <Bar w={120} h={38} r={8} style={{ marginLeft: "auto" }} />
      </div>
      <div className="table-wrap">
        <table className="table">
          <tbody>
            {Array.from({ length: 7 }).map((_, i) => (
              <tr key={i}>
                <td><Bar w="72%" /></td>
                <td><Bar w="58%" /></td>
                <td><Bar w="60%" /></td>
                <td><Bar w={84} h={20} r={999} /></td>
                <td><Bar w="50%" /></td>
                <td><Bar w="44%" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="dashboard">
      <div className="stat-grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <div className="stat-card" key={i}>
            <Bar w="60%" h={10} style={{ marginBottom: 12 }} />
            <Bar w="45%" h={28} />
            <Bar w="52%" h={9} style={{ marginTop: 12 }} />
          </div>
        ))}
      </div>
      <div className="dash-charts">
        {Array.from({ length: 4 }).map((_, i) => (
          <div className="panel chart-panel" key={i}>
            <Bar w="40%" h={13} style={{ marginBottom: 18 }} />
            <Bar w="100%" h={150} r={8} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProjectsSkeleton() {
  return (
    <>
      <div className="toolbar">
        <Bar w={240} h={38} r={8} />
        <Bar w={120} h={38} r={8} style={{ marginLeft: "auto" }} />
      </div>
      {Array.from({ length: 2 }).map((_, p) => (
        <div className="proj-group" key={p} style={{ marginBottom: 16 }}>
          <div className="proj-head">
            <Bar w={16} h={16} />
            <Bar w={170} h={14} />
            <Bar w={48} h={10} />
          </div>
          <div style={{ padding: "2px 0" }}>
            {Array.from({ length: 3 }).map((_, r) => (
              <div key={r} className="sk-task-row">
                <Bar w="38%" />
                <Bar w={64} h={20} r={999} style={{ marginLeft: "auto" }} />
                <Bar w={96} h={20} r={999} />
                <Bar w={70} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
