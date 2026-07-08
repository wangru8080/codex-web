/**
 * CodexWeb Monolith app icon — the canonical brand mark.
 *
 * Used in the brand-anchor surfaces:
 *   1. Runtime selector / Runtime panel (Settings → Runtime) — the
 *      visual identity of the "CodexWeb Runtime" engine entry.
 *   2. New-chat welcome (centered hero above the composer) — the
 *      brand greeting.
 *   3. About page (Settings → About) — the canonical brand surface.
 *   4. Setup Center welcome card.
 *
 * Design:
 *   - 5×5 grid of squares→dots that fade from solid (top-left) to
 *     dispersed (bottom-right). Carries the "context dispersing into
 *     answers" metaphor.
 *   - Shape fills route through `currentColor` so the icon picks up
 *     `text-foreground` (or whatever color the parent sets) and works
 *     in both light and dark themes without per-mode SVG variants.
 *   - Preserves every opacity stop (1.0 / 0.82 / 0.58 / 0.34 / 0.1)
 *     from the master file so the gradient effect is identical.
 *   - 2026-05-21 v2: switched to the cleaned master SVG that drops
 *     the Gaussian-blur backdrop + inner-shadow filters (those
 *     rendered as a dirty halo in the inline SVG path). The new
 *     master file is content-only at 595×595 edge-to-edge; we extend
 *     the viewBox to 655×655 (centered) to add ~5% padding on all
 *     sides so the icon doesn't sit jammed against its container.
 *
 * Sizes: pass `size` (px) for a fixed render, OR omit `size` and rely
 * on the parent's `className="w-X h-X"` for responsive sizing.
 */

import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

interface MonolithIconProps {
  className?: string;
  /** Optional pixel size — leave undefined to fill parent via CSS. */
  size?: number;
  style?: CSSProperties;
}

export function MonolithIcon({ className, size, style }: MonolithIconProps) {
  const sized: CSSProperties | undefined = size != null
    ? { width: size, height: size, ...style }
    : style;
  return (
    // viewBox extends 30px past the 595×595 content on every side
    // (~5% padding) so the icon never reads as cropped against its
    // container edges — matches the breathing room baked into peer
    // brand icons (LobeHub Anthropic / OpenAI).
    <svg
      viewBox="-30 -30 655 655"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('text-foreground', className)}
      style={sized}
      role="img"
      aria-label="CodexWeb"
    >
      <path d="M64 0H32C14.3269 0 0 14.3269 0 32V64C0 81.6731 14.3269 96 32 96H64C81.6731 96 96 81.6731 96 64V32C96 14.3269 81.6731 0 64 0Z" fill="currentColor" />
      <path d="M64 128H32C14.3269 128 0 142.327 0 160V192C0 209.673 14.3269 224 32 224H64C81.6731 224 96 209.673 96 192V160C96 142.327 81.6731 128 64 128Z" fill="currentColor" />
      <path d="M64 256H32C14.3269 256 0 270.327 0 288V320C0 337.673 14.3269 352 32 352H64C81.6731 352 96 337.673 96 320V288C96 270.327 81.6731 256 64 256Z" fill="currentColor" />
      <path opacity="0.82" d="M58.0801 390.08H38.0801C20.407 390.08 6.08008 404.407 6.08008 422.08V442.08C6.08008 459.753 20.407 474.08 38.0801 474.08H58.0801C75.7532 474.08 90.0801 459.753 90.0801 442.08V422.08C90.0801 404.407 75.7532 390.08 58.0801 390.08Z" fill="currentColor" />
      <path opacity="0.58" d="M50.0801 526.08H46.0801C28.407 526.08 14.0801 540.407 14.0801 558.08V562.08C14.0801 579.753 28.407 594.08 46.0801 594.08H50.0801C67.7532 594.08 82.0801 579.753 82.0801 562.08V558.08C82.0801 540.407 67.7532 526.08 50.0801 526.08Z" fill="currentColor" />
      <path d="M192 0H160C142.327 0 128 14.3269 128 32V64C128 81.6731 142.327 96 160 96H192C209.673 96 224 81.6731 224 64V32C224 14.3269 209.673 0 192 0Z" fill="currentColor" />
      <path d="M192 128H160C142.327 128 128 142.327 128 160V192C128 209.673 142.327 224 160 224H192C209.673 224 224 209.673 224 192V160C224 142.327 209.673 128 192 128Z" fill="currentColor" />
      <path opacity="0.82" d="M186.08 262.08H166.08C148.407 262.08 134.08 276.407 134.08 294.08V314.08C134.08 331.753 148.407 346.08 166.08 346.08H186.08C203.753 346.08 218.08 331.753 218.08 314.08V294.08C218.08 276.407 203.753 262.08 186.08 262.08Z" fill="currentColor" />
      <path opacity="0.58" d="M178.08 398.08H174.08C156.407 398.08 142.08 412.407 142.08 430.08V434.08C142.08 451.753 156.407 466.08 174.08 466.08H178.08C195.753 466.08 210.08 451.753 210.08 434.08V430.08C210.08 412.407 195.753 398.08 178.08 398.08Z" fill="currentColor" />
      <path opacity="0.34" d="M202.08 560.08C202.08 545.721 190.439 534.08 176.08 534.08C161.721 534.08 150.08 545.721 150.08 560.08C150.08 574.439 161.721 586.08 176.08 586.08C190.439 586.08 202.08 574.439 202.08 560.08Z" fill="currentColor" />
      <path d="M320 0H288C270.327 0 256 14.3269 256 32V64C256 81.6731 270.327 96 288 96H320C337.673 96 352 81.6731 352 64V32C352 14.3269 337.673 0 320 0Z" fill="currentColor" />
      <path opacity="0.82" d="M314.08 134.08H294.08C276.407 134.08 262.08 148.407 262.08 166.08V186.08C262.08 203.753 276.407 218.08 294.08 218.08H314.08C331.753 218.08 346.08 203.753 346.08 186.08V166.08C346.08 148.407 331.753 134.08 314.08 134.08Z" fill="currentColor" />
      <path opacity="0.58" d="M306.08 270.08H302.08C284.407 270.08 270.08 284.407 270.08 302.08V306.08C270.08 323.753 284.407 338.08 302.08 338.08H306.08C323.753 338.08 338.08 323.753 338.08 306.08V302.08C338.08 284.407 323.753 270.08 306.08 270.08Z" fill="currentColor" />
      <path opacity="0.34" d="M330.08 432.08C330.08 417.721 318.439 406.08 304.08 406.08C289.721 406.08 278.08 417.721 278.08 432.08C278.08 446.439 289.721 458.08 304.08 458.08C318.439 458.08 330.08 446.439 330.08 432.08Z" fill="currentColor" />
      <path opacity="0.1" d="M306.08 542.08H302.08C293.244 542.08 286.08 549.244 286.08 558.08V562.08C286.08 570.917 293.244 578.08 302.08 578.08H306.08C314.917 578.08 322.08 570.917 322.08 562.08V558.08C322.08 549.244 314.917 542.08 306.08 542.08Z" fill="currentColor" />
      <path opacity="0.82" d="M442.08 6.08006H422.08C404.407 6.08006 390.08 20.4069 390.08 38.0801V58.0801C390.08 75.7532 404.407 90.0801 422.08 90.0801H442.08C459.753 90.0801 474.08 75.7532 474.08 58.0801V38.0801C474.08 20.4069 459.753 6.08006 442.08 6.08006Z" fill="currentColor" />
      <path opacity="0.58" d="M434.08 142.08H430.08C412.407 142.08 398.08 156.407 398.08 174.08V178.08C398.08 195.753 412.407 210.08 430.08 210.08H434.08C451.753 210.08 466.08 195.753 466.08 178.08V174.08C466.08 156.407 451.753 142.08 434.08 142.08Z" fill="currentColor" />
      <path opacity="0.34" d="M458.08 304.08C458.08 289.721 446.439 278.08 432.08 278.08C417.721 278.08 406.08 289.721 406.08 304.08C406.08 318.439 417.721 330.08 432.08 330.08C446.439 330.08 458.08 318.439 458.08 304.08Z" fill="currentColor" />
      <path opacity="0.1" d="M434.08 414.08H430.08C421.244 414.08 414.08 421.243 414.08 430.08V434.08C414.08 442.917 421.244 450.08 430.08 450.08H434.08C442.917 450.08 450.08 442.917 450.08 434.08V430.08C450.08 421.243 442.917 414.08 434.08 414.08Z" fill="currentColor" />
      <path opacity="0.58" d="M562.08 14.08H558.08C540.407 14.08 526.08 28.4069 526.08 46.08V50.08C526.08 67.7532 540.407 82.08 558.08 82.08H562.08C579.753 82.08 594.08 67.7532 594.08 50.08V46.08C594.08 28.4069 579.753 14.08 562.08 14.08Z" fill="currentColor" />
      <path opacity="0.34" d="M586.08 176.08C586.08 161.721 574.439 150.08 560.08 150.08C545.721 150.08 534.08 161.721 534.08 176.08C534.08 190.44 545.721 202.08 560.08 202.08C574.439 202.08 586.08 190.44 586.08 176.08Z" fill="currentColor" />
      <path opacity="0.1" d="M562.08 286.08H558.08C549.244 286.08 542.08 293.243 542.08 302.08V306.08C542.08 314.917 549.244 322.08 558.08 322.08H562.08C570.917 322.08 578.08 314.917 578.08 306.08V302.08C578.08 293.243 570.917 286.08 562.08 286.08Z" fill="currentColor" />
    </svg>
  );
}
