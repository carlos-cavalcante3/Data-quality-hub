// Construtores de opções ECharts. Só objetos serializáveis (sem funções),
// pois são montados no servidor e enviados ao componente cliente.

export const C = {
  blue: "#0b4a8b",
  orange: "#f07c1b",
  green: "#15803d",
  amber: "#d97706",
  red: "#c2410c",
  critical: "#b91c1c",
  gray: "#94a3b8",
  grid: "#eef0f3",
};

export function scoreColor(v: number | null | undefined): string {
  if (v === null || v === undefined) return C.gray;
  if (v >= 95) return C.green;
  if (v >= 80) return C.amber;
  return C.red;
}

const baseGrid = { left: 48, right: 24, top: 36, bottom: 32, containLabel: true };
const axisLine = { lineStyle: { color: "#cbd5e1" } };
const splitLine = { lineStyle: { color: C.grid } };

export function lineTrend(opts: {
  days: string[];
  series: { name: string; data: (number | null)[]; color?: string; width?: number; dashed?: boolean }[];
  yMin?: number;
  yMax?: number;
  unit?: string;
  markLines?: { name: string; value: number }[];
  markX?: { label: string; day: string }[];
}) {
  return {
    grid: baseGrid,
    tooltip: { trigger: "axis", valueFormatter: undefined },
    legend: { top: 0, type: "scroll", textStyle: { fontSize: 11 } },
    xAxis: {
      type: "category",
      data: opts.days.map((d) => d.slice(8, 10) + "/" + d.slice(5, 7)),
      axisLine,
      axisLabel: { fontSize: 11 },
    },
    yAxis: { type: "value", min: opts.yMin, max: opts.yMax, axisLabel: { formatter: `{value}${opts.unit ?? ""}`, fontSize: 11 }, splitLine },
    series: opts.series.map((s, i) => ({
      name: s.name,
      type: "line",
      data: s.data,
      smooth: false,
      connectNulls: true,
      symbolSize: 5,
      lineStyle: { width: s.width ?? 2, type: s.dashed ? "dashed" : "solid", color: s.color },
      itemStyle: s.color ? { color: s.color } : undefined,
      markLine:
        i === 0 && (opts.markLines?.length || opts.markX?.length)
          ? {
              symbol: "none",
              silent: true,
              label: { fontSize: 10, formatter: "{b}" },
              lineStyle: { type: "dashed", color: C.orange },
              data: [
                ...(opts.markLines ?? []).map((m) => ({ name: m.name, yAxis: m.value })),
                ...(opts.markX ?? []).map((m) => ({ name: m.label, xAxis: m.day.slice(8, 10) + "/" + m.day.slice(5, 7) })),
              ],
            }
          : undefined,
    })),
  };
}

export function barScores(opts: {
  categories: string[];
  values: (number | null)[];
  horizontal?: boolean;
  links?: string[];
  threshold?: number;
  max?: number;
  unit?: string;
  colorByScore?: boolean;
  color?: string;
  name?: string;
}) {
  const data = opts.values.map((v, i) => ({
    value: v,
    link: opts.links?.[i],
    itemStyle: { color: opts.colorByScore === false ? opts.color ?? C.blue : scoreColor(v), borderRadius: opts.horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0] },
  }));
  const valueAxis = { type: "value", max: opts.max, axisLabel: { formatter: `{value}${opts.unit ?? ""}`, fontSize: 11 }, splitLine };
  const catAxis = { type: "category", data: opts.categories, axisLine, axisLabel: { fontSize: 11, width: 170, overflow: "truncate" }, inverse: opts.horizontal };
  return {
    grid: { ...baseGrid, left: opts.horizontal ? 8 : 48 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: opts.horizontal ? valueAxis : catAxis,
    yAxis: opts.horizontal ? catAxis : valueAxis,
    series: [
      {
        name: opts.name ?? "Valor",
        type: "bar",
        data,
        barMaxWidth: 28,
        label: { show: true, position: opts.horizontal ? "right" : "top", fontSize: 10, formatter: `{c}${opts.unit ?? ""}` },
        markLine: opts.threshold
          ? { symbol: "none", silent: true, lineStyle: { type: "dashed", color: C.orange }, label: { formatter: "meta {c}%", fontSize: 10 }, data: [opts.horizontal ? { xAxis: opts.threshold } : { yAxis: opts.threshold }] }
          : undefined,
        cursor: opts.links ? "pointer" : "default",
      },
    ],
  };
}

export function stackedBars(opts: {
  categories: string[];
  series: { name: string; data: number[]; color?: string }[];
  horizontal?: boolean;
  links?: string[];
  percent?: boolean;
}) {
  const valueAxis = { type: "value", splitLine, axisLabel: { fontSize: 11 } };
  const catAxis = { type: "category", data: opts.categories, axisLine, axisLabel: { fontSize: 11, width: 170, overflow: "truncate" }, inverse: opts.horizontal };
  return {
    grid: { ...baseGrid, left: opts.horizontal ? 8 : 48 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { top: 0, textStyle: { fontSize: 11 } },
    xAxis: opts.horizontal ? valueAxis : catAxis,
    yAxis: opts.horizontal ? catAxis : valueAxis,
    series: opts.series.map((s) => ({
      name: s.name,
      type: "bar",
      stack: "total",
      barMaxWidth: 26,
      itemStyle: s.color ? { color: s.color } : undefined,
      data: s.data.map((v, i) => ({ value: v, link: opts.links?.[i] })),
    })),
  };
}

export function heatmap(opts: { x: string[]; y: string[]; values: [number, number, number | null][]; links?: Record<string, string> }) {
  return {
    grid: { left: 8, right: 16, top: 8, bottom: 56, containLabel: true },
    tooltip: { position: "top" },
    xAxis: { type: "category", data: opts.x, splitArea: { show: true }, axisLabel: { fontSize: 11 } },
    yAxis: { type: "category", data: opts.y, splitArea: { show: true }, axisLabel: { fontSize: 11, width: 170, overflow: "truncate" } },
    visualMap: {
      min: 50,
      max: 100,
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemHeight: 120,
      textStyle: { fontSize: 10 },
      inRange: { color: ["#c2410c", "#f59e0b", "#fde68a", "#bbf7d0", "#15803d"] },
    },
    series: [
      {
        type: "heatmap",
        data: opts.values.map(([x, y, v]) => [x, y, v === null ? "-" : v]),
        label: { show: true, fontSize: 10, formatter: "{@[2]}" },
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,.25)" } },
      },
    ],
  };
}

export function lineVolume(opts: { days: string[]; values: (number | null)[]; name: string }) {
  return {
    grid: baseGrid,
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: opts.days.map((d) => d.slice(8, 10) + "/" + d.slice(5, 7)), axisLine, axisLabel: { fontSize: 11 } },
    yAxis: { type: "value", scale: true, splitLine, axisLabel: { fontSize: 11 } },
    series: [{ name: opts.name, type: "line", data: opts.values, areaStyle: { opacity: 0.08 }, symbolSize: 5, itemStyle: { color: C.blue } }],
  };
}

export function scatterExecutions(opts: { points: { t: number; pipeline: string; status: string; duration: number | null; link?: string }[]; pipelines: string[] }) {
  const statusColor: Record<string, string> = { sucesso: C.green, falha: C.critical, parcial: C.amber, em_andamento: C.blue };
  const byStatus = new Map<string, unknown[]>();
  for (const p of opts.points) {
    const arr = byStatus.get(p.status) ?? [];
    arr.push({ value: [p.t, p.pipeline], link: p.link });
    byStatus.set(p.status, arr);
  }
  return {
    grid: { left: 8, right: 24, top: 32, bottom: 32, containLabel: true },
    tooltip: { trigger: "item" },
    legend: { top: 0, textStyle: { fontSize: 11 } },
    xAxis: { type: "time", axisLine, splitLine, axisLabel: { fontSize: 11 } },
    yAxis: { type: "category", data: opts.pipelines, axisLabel: { fontSize: 11 } },
    series: [...byStatus.entries()].map(([status, data]) => ({
      name: status,
      type: "scatter",
      data,
      symbolSize: status === "falha" ? 11 : 7,
      itemStyle: { color: statusColor[status] ?? C.gray, opacity: 0.85 },
    })),
  };
}
