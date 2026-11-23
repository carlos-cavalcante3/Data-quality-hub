import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Info } from "lucide-react";
import { BAND_LABEL, HEALTH_LABEL, fmtDelta, trendOf } from "@/lib/format";

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {actions && <div className="page-actions no-print">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, children, actions, className }: { title?: ReactNode; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ""}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="no-print">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const BAND_CLASS: Record<string, string> = {
  alta: "ok", intermediaria: "warn", baixa: "bad", dados_insuficientes: "muted", validacao_nao_executada: "muted",
  ok: "ok", atrasado: "warn", critico: "bad", sem_sla: "muted", sem_dados: "muted", sem_evidencia: "muted", erro: "bad",
  sucesso: "ok", falha: "bad", parcial: "warn", em_andamento: "info",
  identificado: "info", comunicado: "info", em_correcao: "warn", parcialmente_corrigido: "warn", resolvido: "ok", nao_aplicavel: "muted",
  baixa_sev: "muted", media: "warn", critica: "bad",
};

export function Badge({ kind, children, title }: { kind: string; children?: ReactNode; title?: string }) {
  const cls = BAND_CLASS[kind] ?? "muted";
  return (
    <span className={`badge badge-${cls}`} title={title}>
      {children ?? BAND_LABEL[kind] ?? HEALTH_LABEL[kind] ?? kind}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = { baixa: "muted", media: "warn", alta: "bad", critica: "bad" };
  const label: Record<string, string> = { baixa: "Baixa", media: "Média", alta: "Alta", critica: "Crítica" };
  return <span className={`badge badge-${map[severity] ?? "muted"} badge-outline`}>{label[severity] ?? severity}</span>;
}

export function Delta({ value, inverse = false }: { value: number | null | undefined; inverse?: boolean }) {
  const t = trendOf(value);
  if (!t) return <span className="delta delta-muted">sem histórico</span>;
  const good = inverse ? t === "piora" : t === "melhora";
  const bad = inverse ? t === "melhora" : t === "piora";
  const Icon = t === "melhora" ? ArrowUpRight : t === "piora" ? ArrowDownRight : ArrowRight;
  return (
    <span className={`delta ${good ? "delta-good" : bad ? "delta-bad" : "delta-muted"}`} title={t === "estavel" ? "Estável" : t === "melhora" ? "Melhoria" : "Deterioração"}>
      <Icon size={13} /> {fmtDelta(value)}
    </span>
  );
}

export function Kpi({
  label, value, hint, band, delta, href, footer, tone,
}: {
  label: string; value: ReactNode; hint?: ReactNode; band?: string; delta?: number | null; href?: string; footer?: ReactNode; tone?: "default" | "brand";
}) {
  const body = (
    <div className={`kpi ${tone === "brand" ? "kpi-brand" : ""} ${band ? `kpi-band-${BAND_CLASS[band] ?? "muted"}` : ""}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-meta">
        {band && <Badge kind={band} />}
        {delta !== undefined && <Delta value={delta} />}
      </div>
      {hint && <div className="kpi-hint">{hint}</div>}
      {footer}
    </div>
  );
  return href ? (
    <Link href={href} className="kpi-link">
      {body}
    </Link>
  ) : (
    body
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Info size={18} />
      <div>
        <strong>{title}</strong>
        {children && <div className="empty-body">{children}</div>}
      </div>
    </div>
  );
}

export function ScoreBar({ value, threshold }: { value: number | null; threshold?: number | null }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  const cls = value >= 95 ? "ok" : value >= 80 ? "warn" : "bad";
  return (
    <div className="scorebar" title={`${value.toFixed(1)}%${threshold ? ` (meta ${threshold}%)` : ""}`}>
      <div className={`scorebar-fill scorebar-${cls}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      {threshold ? <div className="scorebar-target" style={{ left: `${threshold}%` }} /> : null}
    </div>
  );
}

export function Provenance({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="provenance">
      {items.map((i) => (
        <div key={i.label}>
          <dt>{i.label}</dt>
          <dd>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SourceBadge({ source }: { source: string }) {
  const crm = source === "crm";
  return (
    <span
      className={`badge badge-outline ${crm ? "badge-warn" : "badge-info"}`}
      title={crm ? "Cadastro no RD Station — correção pelo departamento" : "Extração/transformação/carga — correção pela Engenharia de Dados"}
    >
      {crm ? "CRM" : "Banco/ETL"}
    </span>
  );
}
