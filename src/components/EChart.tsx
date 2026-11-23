"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import * as echarts from "echarts";
import { Download } from "lucide-react";

export const PALETTE = {
  blue: "#0b4a8b",
  blueLight: "#5b8fd1",
  orange: "#f07c1b",
  green: "#15803d",
  amber: "#d97706",
  red: "#c2410c",
  critical: "#b91c1c",
  gray: "#94a3b8",
  grid: "#e5e7eb",
  text: "#334155",
};
export const SERIES = ["#0b4a8b", "#f07c1b", "#15803d", "#7c3aed", "#0891b2", "#be185d", "#64748b", "#ca8a04"];

type Props = {
  option: echarts.EChartsCoreOption;
  height?: number;
  title?: string;
  subtitle?: string;
  exportName?: string;
  /** chave de dados → URL; clique em um ponto/barra navega para o detalhe */
  links?: Record<string, string>;
  className?: string;
};

export function EChart({ option, height = 280, title, subtitle, exportName, links, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(
      {
        textStyle: { fontFamily: "Inter, system-ui, sans-serif", color: PALETTE.text },
        color: SERIES,
        animationDuration: 300,
        ...option,
      },
      true,
    );
    chart.off("click");
    if (links) {
      chart.on("click", (p: { name?: string; seriesName?: string; data?: unknown }) => {
        const d = p.data as { link?: string } | undefined;
        const href = d?.link ?? (p.name ? links[p.name] : undefined) ?? (p.seriesName ? links[p.seriesName] : undefined);
        if (href) router.push(href);
      });
    }
  }, [option, links, router]);

  function download() {
    const chart = chartRef.current;
    if (!chart) return;
    const url = chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#ffffff" });
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(exportName ?? title ?? "grafico").replace(/[^\w\-]+/g, "_")}_${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  }

  return (
    <div className={`card chart-card ${className ?? ""}`}>
      {(title || exportName) && (
        <div className="card-head">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn no-print" onClick={download} title="Exportar PNG" aria-label="Exportar gráfico como PNG">
            <Download size={15} />
            <span>PNG</span>
          </button>
        </div>
      )}
      <div ref={ref} style={{ height, width: "100%" }} />
    </div>
  );
}
