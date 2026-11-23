"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, BookOpenText, Building2, ClipboardList, Database, FileBarChart2, GitBranch, Gauge, LogOut, Settings, ShieldCheck,
} from "lucide-react";

const NAV = [
  { section: "Monitoramento" },
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/quality", label: "Data Quality", icon: ShieldCheck },
  { href: "/observability", label: "Observability", icon: Activity },
  { href: "/lineage", label: "Data Lineage", icon: GitBranch },
  { section: "Gestão" },
  { href: "/departments", label: "Departamentos", icon: Building2 },
  { href: "/issues", label: "Issues & Corrections", icon: ClipboardList },
  { href: "/reports", label: "Reports", icon: FileBarChart2 },
  { section: "Referência" },
  { href: "/catalog", label: "Catálogo do banco", icon: Database },
  { href: "/docs", label: "Métricas e regras", icon: BookOpenText },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar({ email, role }: { email: string; role: string }) {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" />
        <div>
          <div className="brand-name">Data Quality Hub</div>
          <div className="brand-sub">Engenharia de Dados</div>
        </div>
      </div>
      <nav className="nav">
        {NAV.map((item, i) => {
          if ("section" in item) return <div key={i} className="nav-section">{item.section}</div>;
          const Icon = item.icon;
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={active ? "active" : ""}>
              <Icon size={16} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        <div className="email">{email}</div>
        <div className="muted" style={{ marginBottom: 8 }}>Perfil: {role}</div>
        <form action="/auth/signout" method="post">
          <button className="icon-btn" type="submit">
            <LogOut size={13} /> Sair
          </button>
        </form>
      </div>
    </aside>
  );
}
