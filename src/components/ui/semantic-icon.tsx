/**
 * CodexWeb semantic icon layer (Phase 7).
 *
 * Business code MUST use `<CodexWebIcon name="model" />` rather than
 * importing vendor icon names directly. This layer:
 *   1. Decouples user-facing semantics from vendor library identity
 *      (HugeIcons free / Phosphor fallback / future libraries).
 *   2. Pins ONE icon per concept so the same concept renders the same
 *      glyph everywhere.
 *   3. Forces conflict resolution at this map (Brain / Lightning /
 *      Terminal were overloaded — see docs/handover/icon-system.md
 *      Section III for the historical decision log).
 *
 * Adding a new semantic alias:
 *   - Add the alias to CodexWebIconName + SEMANTIC_MAP.
 *   - Confirm the HugeIcons candidate exists in
 *     `@hugeicons/core-free-icons` (some names diverge from training
 *     intuition, e.g. CommandLineIcon exists, Code02Icon doesn't).
 *   - Update `docs/handover/icon-system.md` (Section I + II) with the
 *     same alias + candidate so the doc and code don't drift.
 *
 * Do NOT:
 *   - Introduce a third icon vendor (Lucide, Tabler, Hero, etc.) —
 *     if HugeIcons free lacks a glyph, fall back to Phosphor here.
 *   - Use this layer for brand icons (Anthropic / OpenAI / Kimi / ...).
 *     Brand icons live in `@/components/icons/provider-icons` and are used
 *     only by provider-presets / RuntimePanel / RuntimeSelector.
 */
import { HugeiconsIcon } from '@hugeicons/react';
import {
  // Navigation
  DashboardCircleEditIcon,
  Settings02Icon,
  PaintBoardIcon,
  HeartCheckIcon,
  Analytics02Icon,
  InformationCircleIcon,
  HelpCircleIcon,
  // Provider / Model / Runtime
  Plug02Icon,
  CubeIcon,
  ChipIcon,
  // Capability
  Robot01Icon,
  Timer02Icon,
  BridgeIcon,
  PuzzleIcon,
  MagicWand03Icon,
  McpServerIcon,
  CommandLineIcon,
  TerminalIcon,
  // Resource
  File01Icon,
  FileCodeIcon,
  Folder01Icon,
  Folder02Icon,
  FolderAddIcon,
  FolderOpenIcon,
  CodeIcon,
  Layers02Icon,
  EyeIcon,
  BrainIcon,
  ComponentIcon,
  Image01Icon,
  MusicNote01Icon,
  Video01Icon,
  Attachment01Icon,
  // Action / State
  Shield01Icon,
  Tick02Icon,
  Alert02Icon,
  AlertCircleIcon,
  Loading02Icon,
  // Workspace
  GitBranchIcon,
  GitCommitIcon,
  // Generic UI (Phase 2 broadened — visible refresh across NavRail /
  // ChatListPanel / FileTree / WorkspaceSidebar / Settings / Chat)
  Chat01Icon,
  Search01Icon,
  PlusSignIcon,
  SidebarLeft01Icon,
  PanelLeftIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightIcon,
  HierarchyFilesIcon,
  FavouriteIcon,
  Tag01Icon,
  Bookmark01Icon,
  ArrowUpRight01Icon,
  ArchiveIcon,
  ArrowLeftDoubleIcon,
  ArrowRightDoubleIcon,
  Pin02Icon,
  Refresh01Icon,
  Note01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  PencilEdit01Icon,
  Copy01Icon,
  Delete01Icon,
  Wrench01Icon,
  Store01Icon,
  HardDriveIcon,
  ComputerActivityIcon,
  Globe02Icon,
  GlobeIcon,
  Coins01Icon,
  Download01Icon,
  Upload01Icon,
  Cancel01Icon,
  Sun01Icon,
  Moon01Icon,
  Notification01Icon,
  StopIcon,
  PlayCircleIcon,
  Book01Icon,
  ChartBarBigIcon,
  FilterIcon,
  MoreHorizontalCircle01Icon,
  StethoscopeIcon,
  CloudUploadIcon,
} from '@hugeicons/core-free-icons';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Semantic alias enum — the single source of truth for what icons
 * CodexWeb business code is allowed to ask for. Adding values here is
 * the only way to introduce a new product concept into the icon layer.
 */
export type CodexWebIconName =
  // Navigation
  | 'overview'
  | 'settings'
  | 'appearance'
  | 'health'
  | 'usage'
  | 'about'
  | 'help'
  // Provider / Model / Runtime
  | 'provider'
  | 'model'
  | 'runtime'
  // Capability
  | 'assistant'
  | 'task'
  | 'bridge'
  | 'plugin'
  | 'skill'
  | 'mcp'
  | 'cli'
  | 'terminal'
  // Resource
  | 'file'
  | 'file_code'
  | 'folder'
  | 'folder_open'
  | 'folder_add'
  | 'workspace'
  | 'code'
  | 'artifact'
  | 'preview'
  | 'memory'
  | 'widget'
  | 'image'
  | 'media_audio'
  | 'media_video'
  | 'attachment'
  // Action / State
  | 'permission'
  | 'success'
  | 'warning'
  | 'error'
  | 'loading'
  // Git / Workspace
  | 'git'
  | 'git_commit'
  // Generic UI primitives (Phase 2 broader — visible refresh)
  | 'chat'
  | 'search'
  | 'plus'
  | 'sidebar'
  | 'panel_left'
  | 'panel_left_close'
  | 'panel_left_open'
  | 'panel_right'
  | 'file_tree'
  | 'favorite'
  | 'tag'
  | 'bookmark'
  | 'external'
  | 'archive'
  | 'sidebar_collapse'
  | 'sidebar_collapse_right'
  | 'pin'
  | 'refresh'
  | 'note'
  | 'back'
  | 'forward'
  | 'edit'
  | 'copy'
  | 'delete'
  | 'cancel'
  | 'more'
  | 'filter'
  | 'wrench'
  | 'marketplace'
  | 'disk'
  | 'desktop'
  | 'web'
  | 'web_simple'
  | 'cost'
  | 'download'
  | 'upload'
  | 'upload_cloud'
  | 'theme_light'
  | 'theme_dark'
  | 'notification'
  | 'stop'
  | 'play'
  | 'book'
  | 'chart'
  | 'diagnose';

// HugeIcons IconSvgElement is a 2-tuple array; we match its surface
// here to avoid pulling its private types.
type HugeiconsSvg = ComponentProps<typeof HugeiconsIcon>['icon'];

/**
 * Phase 0 → Phase 1 semantic map.
 *
 * Each entry is the canonical glyph for one product concept. Conflict
 * resolutions enshrined here:
 *   - `model` uses CubeIcon (Brain handed to `memory`).
 *   - `runtime` uses ChipIcon (Lightning retired as the overloaded
 *     vendor symbol).
 *   - `cli` uses CommandLineIcon, `terminal` uses TerminalIcon — they
 *     are explicitly NOT the same glyph anymore.
 *
 * See docs/handover/icon-system.md Section III for the decision log.
 */
const SEMANTIC_MAP: Record<CodexWebIconName, HugeiconsSvg> = {
  // Navigation
  overview: DashboardCircleEditIcon,
  settings: Settings02Icon,
  appearance: PaintBoardIcon,
  health: HeartCheckIcon,
  usage: Analytics02Icon,
  about: InformationCircleIcon,
  help: HelpCircleIcon,
  // Provider / Model / Runtime — the three-layer mental model
  provider: Plug02Icon,
  model: CubeIcon,
  runtime: ChipIcon,
  // Capability
  assistant: Robot01Icon,
  task: Timer02Icon,
  bridge: BridgeIcon,
  plugin: PuzzleIcon,
  skill: MagicWand03Icon,
  mcp: McpServerIcon,
  cli: CommandLineIcon,
  terminal: TerminalIcon,
  // Resource
  file: File01Icon,
  file_code: FileCodeIcon,
  folder: Folder01Icon,
  folder_open: FolderOpenIcon,
  folder_add: FolderAddIcon,
  workspace: Folder02Icon,
  code: CodeIcon,
  artifact: Layers02Icon,
  preview: EyeIcon,
  memory: BrainIcon,
  widget: ComponentIcon,
  image: Image01Icon,
  media_audio: MusicNote01Icon,
  media_video: Video01Icon,
  attachment: Attachment01Icon,
  // Action / State
  permission: Shield01Icon,
  success: Tick02Icon,
  warning: Alert02Icon,
  error: AlertCircleIcon,
  loading: Loading02Icon,
  // Git / Workspace
  git: GitBranchIcon,
  git_commit: GitCommitIcon,
  // Generic UI primitives
  chat: Chat01Icon,
  search: Search01Icon,
  plus: PlusSignIcon,
  sidebar: SidebarLeft01Icon,
  panel_left: PanelLeftIcon,
  panel_left_close: PanelLeftCloseIcon,
  panel_left_open: PanelLeftOpenIcon,
  panel_right: PanelRightIcon,
  file_tree: HierarchyFilesIcon,
  favorite: FavouriteIcon,
  tag: Tag01Icon,
  bookmark: Bookmark01Icon,
  external: ArrowUpRight01Icon,
  archive: ArchiveIcon,
  sidebar_collapse: ArrowLeftDoubleIcon,
  sidebar_collapse_right: ArrowRightDoubleIcon,
  pin: Pin02Icon,
  refresh: Refresh01Icon,
  note: Note01Icon,
  back: ArrowLeft01Icon,
  forward: ArrowRight01Icon,
  edit: PencilEdit01Icon,
  copy: Copy01Icon,
  delete: Delete01Icon,
  cancel: Cancel01Icon,
  more: MoreHorizontalCircle01Icon,
  filter: FilterIcon,
  wrench: Wrench01Icon,
  marketplace: Store01Icon,
  disk: HardDriveIcon,
  desktop: ComputerActivityIcon,
  web: Globe02Icon,
  web_simple: GlobeIcon,
  cost: Coins01Icon,
  download: Download01Icon,
  upload: Upload01Icon,
  upload_cloud: CloudUploadIcon,
  theme_light: Sun01Icon,
  theme_dark: Moon01Icon,
  notification: Notification01Icon,
  stop: StopIcon,
  play: PlayCircleIcon,
  book: Book01Icon,
  chart: ChartBarBigIcon,
  diagnose: StethoscopeIcon,
};

/**
 * Canonical icon size tokens. Match the existing ICON_SIZE constants
 * in `src/components/ui/icon.tsx` so Phase 2 migrations don't introduce
 * subtle pixel drift.
 *
 * - sm (14): toolbar / inline secondary
 * - md (16): inline / row default
 * - lg (20): card header / section anchor
 * - xl (24): empty state / hero-lite
 */
export const CODEXWEB_ICON_SIZE = {
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
} as const;

export type CodexWebIconSize = keyof typeof CODEXWEB_ICON_SIZE | number;

export interface CodexWebIconProps {
  /** Semantic alias — see CodexWebIconName for the full list. */
  name: CodexWebIconName;
  /**
   * Either a size token (`'sm' | 'md' | 'lg' | 'xl'`) or a raw pixel
   * number. Prefer tokens; raw numbers are an escape hatch only.
   */
  size?: CodexWebIconSize;
  className?: string;
  /**
   * Accessibility label. Required for icon-only buttons; optional when
   * the icon sits next to a visible text label.
   */
  'aria-label'?: string;
  /** Hide the icon from assistive tech when it is purely decorative. */
  'aria-hidden'?: boolean;
  /**
   * Optional stroke width override. HugeIcons defaults to 1.5; bump to
   * 2 for emphasis (e.g. active nav). Leave undefined to inherit.
   */
  strokeWidth?: number;
}

function resolveSize(size: CodexWebIconSize | undefined): number {
  if (size === undefined) return CODEXWEB_ICON_SIZE.md;
  if (typeof size === 'number') return size;
  return CODEXWEB_ICON_SIZE[size];
}

export function CodexWebIcon({
  name,
  size,
  className,
  'aria-label': ariaLabel,
  'aria-hidden': ariaHidden,
  strokeWidth,
}: CodexWebIconProps) {
  const iconDef = SEMANTIC_MAP[name];
  const pixelSize = resolveSize(size);
  // Default = `text-muted-foreground` (light/secondary tone). Phase 7
  // (2026-05-21) color semantic:
  //   - Most icons are "secondary affordance" — they sit next to text
  //     labels and shouldn't compete with the label for attention.
  //     Default light gives the label primacy.
  //   - Anchor icons (left rail / sidebar quick actions / Settings
  //     left nav) live without an adjacent label OR represent the
  //     primary nav target. Pass `className="text-inherit"` to make
  //     them follow the parent text color (which is dark by design
  //     in those surfaces).
  //   - Active / selected / hover states are handled by the parent
  //     button / link adjusting its `text-*` class on the right
  //     state; child icons follow via currentColor inheritance when
  //     they opt into `text-inherit`.
  //   - Brand mark (MonolithIcon) is a separate component that
  //     defaults to `text-foreground` because it represents app
  //     identity, not "an icon next to a label".
  //
  // tailwind-merge in `cn` ensures the consumer's className (e.g.
  // 'text-inherit' or 'text-status-success-foreground') replaces the
  // default 'text-muted-foreground' — both are in the text-color
  // group so the later wins.
  return (
    <HugeiconsIcon
      icon={iconDef}
      size={pixelSize}
      strokeWidth={strokeWidth}
      className={cn('text-muted-foreground', className)}
      aria-label={ariaLabel}
      aria-hidden={ariaHidden}
      role={ariaLabel ? 'img' : undefined}
    />
  );
}
