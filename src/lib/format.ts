const nf = new Intl.NumberFormat("pt-BR");
const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const TZ = "America/Sao_Paulo";

export function fmtInt(v: number | null | undefined): string {
  return v === null || v === undefined || Number.isNaN(v) ? "—" : nf.format(v);
}
export function fmtNum(v: number | null | undefined): string {
  return v === null || v === undefined || Number.isNaN(v) ? "—" : nf2.format(v);
}
export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return (digits === 1 ? nf1.format(v) : nf2.format(v)) + "%";
}
export function fmtDelta(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  const s = nf1.format(Math.abs(v));
  return v > 0 ? `+${s} p.p.` : v < 0 ? `−${s} p.p.` : "0,0 p.p.";
}
export function fmtDateTime(v: Date | string | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  return d.toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function fmtDate(v: Date | string | null | undefined): string {
  if (!v) return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-");
    return `${d}/${m}/${y}`;
  }
  const d = typeof v === "string" ? new Date(v) : v;
  return d.toLocaleDateString("pt-BR", { timeZone: TZ });
}
export function fmtAgo(v: Date | string | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  const min = (Date.now() - d.getTime()) / 60000;
  if (min < 1) return "agora";
  if (min < 60) return `há ${Math.round(min)} min`;
  const h = min / 60;
  if (h < 48) return `há ${nf1.format(h)} h`;
  return `há ${Math.round(h / 24)} dias`;
}
export function fmtBytes(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const u = ["B", "kB", "MB", "GB"];
  let i = 0;
  let n = v;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${nf1.format(n)} ${u[i]}`;
}
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${nf1.format(seconds)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m} min ${s} s`;
}

export const BAND_LABEL: Record<string, string> = {
  alta: "Qualidade alta",
  intermediaria: "Intermediária",
  baixa: "Qualidade baixa",
  dados_insuficientes: "Dados insuficientes",
  validacao_nao_executada: "Validação não executada",
};
export const HEALTH_LABEL: Record<string, string> = {
  ok: "Saudável",
  atrasado: "Atrasado",
  critico: "Crítico",
  sem_sla: "Sem SLA",
  sem_dados: "Sem dados",
  sem_evidencia: "Sem evidência",
  erro: "Erro",
};
export const STATUS_LABEL: Record<string, string> = {
  sucesso: "Sucesso",
  falha: "Falha",
  parcial: "Parcial",
  em_andamento: "Em andamento",
  cancelado: "Cancelado",
};
export const ISSUE_STATUS: { value: string; label: string }[] = [
  { value: "identificado", label: "Identificado" },
  { value: "comunicado", label: "Comunicado" },
  { value: "em_correcao", label: "Em correção" },
  { value: "parcialmente_corrigido", label: "Parcialmente corrigido" },
  { value: "resolvido", label: "Resolvido" },
  { value: "nao_aplicavel", label: "Não aplicável" },
];
export const ISSUE_STATUS_LABEL = Object.fromEntries(ISSUE_STATUS.map((s) => [s.value, s.label]));
export const SEVERITY_LABEL: Record<string, string> = { baixa: "Baixa", media: "Média", alta: "Alta", critica: "Crítica" };
export const DIMENSION_LABEL: Record<string, string> = {
  completude: "Completude",
  validade: "Validade",
  unicidade: "Unicidade",
  consistencia: "Consistência",
  integridade: "Integridade",
  atualidade: "Atualidade",
};

export function bandOf(score: number | null | undefined, evaluated?: number | null): string {
  if (score === null || score === undefined) return "dados_insuficientes";
  if (evaluated !== undefined && evaluated !== null && evaluated < 20) return "dados_insuficientes";
  if (score >= 95) return "alta";
  if (score >= 80) return "intermediaria";
  return "baixa";
}

export function trendOf(delta: number | null | undefined): "melhora" | "estavel" | "piora" | null {
  if (delta === null || delta === undefined) return null;
  if (delta > 0.5) return "melhora";
  if (delta < -0.5) return "piora";
  return "estavel";
}

export const PERIOD_OPTIONS = [
  { value: "30", label: "Últimos 30 dias" },
  { value: "90", label: "Últimos 90 dias" },
  { value: "180", label: "Últimos 180 dias" },
  { value: "365", label: "Último ano" },
];
