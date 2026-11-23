/** Exibido instantaneamente ao trocar de tela enquanto os dados carregam. */
export default function Loading() {
  return (
    <div className="skeleton-page" aria-busy="true" aria-label="Carregando">
      <div className="sk sk-eyebrow" />
      <div className="sk sk-title" />
      <div className="sk sk-line" />
      <div className="grid g-6" style={{ marginTop: 18 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="sk sk-kpi" />
        ))}
      </div>
      <div className="grid g-2" style={{ marginTop: 14 }}>
        <div className="sk sk-chart" />
        <div className="sk sk-chart" />
      </div>
      <div className="sk sk-table" style={{ marginTop: 14 }} />
    </div>
  );
}
