/** Marca do Hub: quadrado azul Avantia, "D" de dados em branco e detalhe laranja. */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Data Quality Hub" style={{ flex: "none" }}>
      <defs>
        <clipPath id="dqh-clip">
          <rect width="32" height="32" rx="8" />
        </clipPath>
      </defs>
      <g clipPath="url(#dqh-clip)">
        <rect width="32" height="32" fill="#0b4a8b" />
        <circle cx="30" cy="30" r="8" fill="#f07c1b" />
      </g>
      <path d="M9.5 8h6.2c5.1 0 8.3 3.1 8.3 8s-3.2 8-8.3 8H9.5V8zm4 3.5v9h2.1c2.6 0 4.2-1.7 4.2-4.5s-1.6-4.5-4.2-4.5h-2.1z" fill="#ffffff" />
    </svg>
  );
}
