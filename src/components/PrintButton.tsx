"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button type="button" className="btn btn-accent" onClick={() => window.print()}>
      <Printer size={14} /> Exportar PDF / imprimir
    </button>
  );
}
