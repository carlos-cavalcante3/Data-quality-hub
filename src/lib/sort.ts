// Ordenação padronizada em todo o Hub.
//  - Listas de PROBLEMAS (afetados): mais registros afetados primeiro → severidade → nome.
//  - Listas de SCORE: pior score primeiro → severidade → nome.
//  - Tabela de regras: o usuário escolhe; padrão "prioridade" (fora da meta, severidade, afetados).

export const SEVERITY_RANK: Record<string, number> = { critica: 4, alta: 3, media: 2, baixa: 1 };

type Sortable = {
  name?: string; rule_name?: string; problem_label?: string | null; severity?: string;
  records_failed?: number | null; failed?: number; quality_score?: number | null; score?: number | null;
  meets_threshold?: boolean | null; dimension?: string; code?: string;
};

const failed = (r: Sortable) => r.records_failed ?? r.failed ?? 0;
const score = (r: Sortable) => r.quality_score ?? r.score ?? null;
const sev = (r: Sortable) => SEVERITY_RANK[r.severity ?? ""] ?? 0;
const label = (r: Sortable) => (r.problem_label ?? r.name ?? r.rule_name ?? r.code ?? "").toLowerCase();

export function byAffected<T extends Sortable>(a: T, b: T) {
  return failed(b) - failed(a) || sev(b) - sev(a) || label(a).localeCompare(label(b), "pt-BR");
}

export function byWorstScore<T extends Sortable>(a: T, b: T) {
  const sa = score(a), sb = score(b);
  if (sa === null && sb !== null) return 1;
  if (sb === null && sa !== null) return -1;
  return (sa ?? 0) - (sb ?? 0) || sev(b) - sev(a) || label(a).localeCompare(label(b), "pt-BR");
}

export function byPriority<T extends Sortable>(a: T, b: T) {
  const oa = a.meets_threshold === false ? 1 : 0;
  const ob = b.meets_threshold === false ? 1 : 0;
  return ob - oa || sev(b) - sev(a) || byAffected(a, b);
}

export const RULE_SORTS = [
  { value: "prioridade", label: "Prioridade (fora da meta, severidade, afetados)" },
  { value: "afetados", label: "Mais registros afetados" },
  { value: "score", label: "Pior score primeiro" },
  { value: "severidade", label: "Severidade" },
  { value: "nome", label: "Ordem alfabética" },
  { value: "dimensao", label: "Dimensão" },
];

export function sortRules<T extends Sortable>(rules: T[], mode: string | undefined): T[] {
  const arr = [...rules];
  switch (mode) {
    case "afetados": return arr.sort(byAffected);
    case "score": return arr.sort(byWorstScore);
    case "severidade": return arr.sort((a, b) => sev(b) - sev(a) || byAffected(a, b));
    case "nome": return arr.sort((a, b) => label(a).localeCompare(label(b), "pt-BR"));
    case "dimensao": return arr.sort((a, b) => (a.dimension ?? "").localeCompare(b.dimension ?? "") || byAffected(a, b));
    default: return arr.sort(byPriority);
  }
}

/** Nome do problema (quando a regra falha). Cai para a expectativa se não houver rótulo. */
export function problemOf(r: { problem_label?: string | null; name?: string; rule_name?: string }) {
  return r.problem_label ?? r.name ?? r.rule_name ?? "";
}
