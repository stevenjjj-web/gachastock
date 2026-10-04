import { THEMES, type Stock } from "@/lib/config";

/** The bull mascot's face, drawn in a 120×120 box. */
function BullFace() {
  return (
    <>
      <path d="M26 40c-12-4-17-16-13-27 9 3 19 10 23 20z" fill="#FFF6E0" />
      <path d="M94 40c12-4 17-16 13-27-9 3-19 10-23 20z" fill="#FFF6E0" />
      <ellipse cx="14" cy="58" rx="13" ry="9" transform="rotate(-18 14 58)" fill="#FFB237" />
      <ellipse cx="106" cy="58" rx="13" ry="9" transform="rotate(18 106 58)" fill="#FFB237" />
      <ellipse cx="14" cy="58" rx="7" ry="4.5" transform="rotate(-18 14 58)" fill="#FF8AC8" />
      <ellipse cx="106" cy="58" rx="7" ry="4.5" transform="rotate(18 106 58)" fill="#FF8AC8" />
      <ellipse cx="60" cy="66" rx="46" ry="42" fill="#FFC94D" />
      <path d="M48 27c3-8 9-11 12-11s9 3 12 11c-6 3-18 3-24 0z" fill="#FFB237" />
      <ellipse cx="60" cy="84" rx="27" ry="18" fill="#FFE9B8" />
      <ellipse cx="51" cy="84" rx="3.6" ry="5" fill="#E58A2B" />
      <ellipse cx="69" cy="84" rx="3.6" ry="5" fill="#E58A2B" />
      <circle cx="40" cy="60" r="7.5" fill="#280D5F" />
      <circle cx="80" cy="60" r="7.5" fill="#280D5F" />
      <circle cx="42.5" cy="57.5" r="2.6" fill="#fff" />
      <circle cx="82.5" cy="57.5" r="2.6" fill="#fff" />
      <ellipse cx="26" cy="74" rx="7" ry="4.5" fill="#FF8AC8" opacity=".7" />
      <ellipse cx="94" cy="74" rx="7" ry="4.5" fill="#FF8AC8" opacity=".7" />
    </>
  );
}

export function BullHead({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" className={className} aria-hidden>
      <BullFace />
    </svg>
  );
}

// Foil pack outline with crimped (zigzag) top and bottom edges, in a 200×300 box
const TEETH = 14;
const TOOTH = 172 / TEETH;
const r1 = (n: number) => Math.round(n * 10) / 10;
const PACK_PATH = [
  "M14 14",
  ...Array.from({ length: TEETH }, (_, i) => `L${r1(14 + TOOTH * (i + 0.5))} 6 L${r1(14 + TOOTH * (i + 1))} 14`),
  "L186 286",
  ...Array.from({ length: TEETH }, (_, i) => `L${r1(186 - TOOTH * (i + 0.5))} 294 L${r1(186 - TOOTH * (i + 1))} 286`),
  "Z",
].join(" ");

/** A sealed foil pack. `theme` picks the colours, `symbol` is printed on the front. */
export function PackArt({ theme, symbol, className = "" }: { theme: number; symbol: string; className?: string }) {
  const t = THEMES[theme % THEMES.length];
  const id = `pack-${theme % THEMES.length}`;
  return (
    <svg viewBox="0 0 200 300" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={t.from} />
          <stop offset="1" stopColor={t.to} />
        </linearGradient>
        <clipPath id={`${id}-c`}>
          <path d={PACK_PATH} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-c)`}>
        <rect width="200" height="300" fill={`url(#${id}-g)`} />
        {/* Foil sheen */}
        <path d="M-20 210 L120 -10 L170 -10 L30 210z" fill="#fff" opacity=".2" />
        <path d="M70 320 L210 100 L230 100 L90 320z" fill="#fff" opacity=".12" />
        {/* Crimped seals */}
        <rect y="0" width="200" height="36" fill={t.ink} opacity=".28" />
        <rect y="264" width="200" height="36" fill={t.ink} opacity=".28" />
        {Array.from({ length: 22 }, (_, i) => (
          <path key={i} d={`M${6 + i * 9} 6V34M${6 + i * 9} 266V294`} stroke="#fff" strokeWidth="1.5" opacity=".28" />
        ))}
        {/* Badge */}
        <circle cx="100" cy="132" r="56" fill={t.ink} opacity=".3" />
        <circle cx="100" cy="132" r="50" fill="#fff" opacity=".16" />
        <g transform="translate(55 86) scale(.75)">
          <BullFace />
        </g>
        <text
          x="100"
          y="232"
          textAnchor="middle"
          fontSize={symbol.length > 6 ? 24 : 32}
          fontWeight="800"
          letterSpacing="1"
          fill={t.ink}
          fontFamily="var(--font-grotesk), sans-serif"
        >
          {symbol}
        </text>
        <text x="100" y="252" textAnchor="middle" fontSize="10" fontWeight="700" letterSpacing="3" fill={t.ink} opacity=".7" fontFamily="var(--font-grotesk), sans-serif">
          GACHASTOCK
        </text>
      </g>
      <path d={PACK_PATH} fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="1.5" />
    </svg>
  );
}

export function StockCoin({ stock, size = 48 }: { stock: Stock; size?: number }) {
  const label = stock.ticker.replace(/x$/, "");
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center rounded-full font-extrabold text-white"
      style={{
        width: size,
        height: size,
        background: stock.color,
        fontSize: size * (label.length > 4 ? 0.23 : label.length > 3 ? 0.27 : 0.32),
        boxShadow: `inset 0 -${Math.max(2, size / 12)}px 0 rgba(0,0,0,.25), 0 0 0 ${Math.max(1.5, size / 22)}px rgba(255,255,255,.85)`,
      }}
    >
      {label}
    </span>
  );
}

export function Sparkle({ size = 20, color = "#FFB237", className = "" }: { size?: number; color?: string; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M12 0c1 7 5 11 12 12-7 1-11 5-12 12-1-7-5-11-12-12 7-1 11-5 12-12z" fill={color} />
    </svg>
  );
}
