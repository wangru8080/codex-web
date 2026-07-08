import { cn } from '@/lib/utils';
import type { CSSProperties } from 'react';

interface CodexWebLogoProps {
  className?: string;
  /** Inline size (px). When omitted, the SVG fills its container. Used
   *  by the RuntimeSelector trigger / dropdown items where the icon
   *  sits next to small text and needs a concrete pixel size. */
  size?: number;
  style?: CSSProperties;
}

export function CodexWebLogo({ className, size, style }: CodexWebLogoProps) {
  const sized: CSSProperties | undefined = size != null
    ? { width: size, height: size, ...style }
    : style;
  return (
    <svg
      viewBox="-150 -150 300 300"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("rounded-full", className)}
      style={sized}
    >
      {/* Background: gray in light, dark in dark mode */}
      <rect
        x="-150" y="-150" width="300" height="300"
        className="fill-[#e0e0e0] dark:fill-[#2a2a2a]"
      />

      <defs>
        <g id="codepilot-cube">
          {/* Top Face */}
          <path
            d="M0,0 L0,-30 L25.98,-15 L25.98,15 Z"
            className="fill-[#e0e0e0] stroke-black dark:fill-[#2a2a2a] dark:stroke-white"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* Left Face */}
          <path
            d="M0,0 L25.98,15 L0,30 L-25.98,15 Z"
            className="fill-[#e0e0e0] stroke-black dark:fill-[#2a2a2a] dark:stroke-white"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* Right Face */}
          <path
            d="M0,0 L-25.98,15 L-25.98,-15 L0,-30 Z"
            className="fill-[#e0e0e0] stroke-black dark:fill-[#2a2a2a] dark:stroke-white"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </g>
      </defs>

      {/* Layer Z = -1 (Bottom) */}
      <use href="#codepilot-cube" x="-25.98" y="15" />
      <use href="#codepilot-cube" x="25.98"  y="15" />
      <use href="#codepilot-cube" x="0"      y="30" />
      <use href="#codepilot-cube" x="-25.98" y="45" />
      <use href="#codepilot-cube" x="25.98"  y="45" />

      {/* Layer Z = 0 (Middle) */}
      <use href="#codepilot-cube" x="0"      y="-30" />
      <use href="#codepilot-cube" x="-25.98" y="-15" />
      <use href="#codepilot-cube" x="25.98"  y="-15" />
      <use href="#codepilot-cube" x="0"      y="0" />
      <use href="#codepilot-cube" x="-51.96" y="0" />
      <use href="#codepilot-cube" x="51.96"  y="0" />
      <use href="#codepilot-cube" x="-25.98" y="15" />
      <use href="#codepilot-cube" x="25.98"  y="15" />
      <use href="#codepilot-cube" x="0"      y="30" />

      {/* Layer Z = 1 (Top) */}
      <use href="#codepilot-cube" x="-25.98" y="-45" />
      <use href="#codepilot-cube" x="25.98"  y="-45" />
      <use href="#codepilot-cube" x="0"      y="-30" />
      <use href="#codepilot-cube" x="-25.98" y="-15" />
      <use href="#codepilot-cube" x="25.98"  y="-15" />
    </svg>
  );
}
