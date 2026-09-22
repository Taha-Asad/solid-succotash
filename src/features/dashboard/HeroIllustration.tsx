export default function HeroIllustration({ size = 180 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={(size * 130) / 180}
      viewBox="0 0 180 130"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ overflow: "visible" }}
    >
      {/* Bottom book / base package (Navy / Indigo) */}
      <g filter="drop-shadow(0 12px 20px rgba(79, 97, 237, 0.18))">
        {/* Left face */}
        <polygon points="20,76 88,110 88,124 20,90" fill="#3645B0" />
        {/* Right face */}
        <polygon points="88,110 160,78 160,92 88,124" fill="#293592" />
        {/* Top face */}
        <polygon points="88,60 160,28 92,-4 20,28" transform="translate(0, 48)" fill="#4F61ED" />
      </g>

      {/* Middle book / layer (Soft Peach / Coral) */}
      <g transform="translate(6, -20)" filter="drop-shadow(0 8px 16px rgba(226, 125, 96, 0.15))">
        {/* Left face */}
        <polygon points="26,68 90,98 90,110 26,80" fill="#E27D60" />
        {/* Right face */}
        <polygon points="90,98 154,68 154,80 90,110" fill="#C56247" />
        {/* Top face */}
        <polygon points="90,56 154,26 90,-4 26,26" transform="translate(0, 42)" fill="#F09880" />
      </g>

      {/* Top Invoice / Register Pad (Crisp White & Periwinkle) */}
      <g transform="translate(14, -38)" filter="drop-shadow(0 10px 24px rgba(28, 34, 55, 0.08))">
        {/* Left face */}
        <polygon points="34,60 92,86 92,94 34,68" fill="#CBD5E1" />
        {/* Right face */}
        <polygon points="92,86 148,60 148,68 92,94" fill="#94A3B8" />
        {/* Top sheet */}
        <polygon points="92,48 148,22 90,-4 34,22" transform="translate(0, 38)" fill="#FFFFFF" />

        {/* Invoice lines / details on sheet */}
        <line x1="56" y1="46" x2="84" y2="58" stroke="#4F61ED" strokeWidth="3" strokeLinecap="round" />
        <line x1="94" y1="53" x2="122" y2="40" stroke="#E2E8F0" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="62" y1="58" x2="90" y2="70" stroke="#64748B" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="98" y1="65" x2="118" y2="56" stroke="#4F61ED" strokeWidth="2.5" strokeLinecap="round" />

        {/* Small check badge */}
        <circle cx="92" cy="38" r="8" fill="#38A169" />
        <path d="M89 38L91.5 40.5L95.5 35.5" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
