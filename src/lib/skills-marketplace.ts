import type { MarketplaceSkill } from "@/types";

export const SKILLS_SH_API = "https://skills.sh/api/v1";

type SkillsShListing = {
  id?: unknown;
  slug?: unknown;
  skillId?: unknown;
  name?: unknown;
  source?: unknown;
  installs?: unknown;
  sourceType?: unknown;
  installUrl?: unknown;
  url?: unknown;
  isDuplicate?: unknown;
};

export type SkillsShDetail = {
  id?: unknown;
  source?: unknown;
  slug?: unknown;
  installs?: unknown;
  files?: unknown;
};

export function mapSkillsShSkill(value: SkillsShListing): MarketplaceSkill | null {
  const id = stringValue(value.id);
  const slug = stringValue(value.slug) || stringValue(value.skillId) || id.split("/").pop() || "";
  const source = stringValue(value.source) || id.split("/").slice(0, -1).join("/");
  if (!id || !slug || !source) return null;

  return {
    id,
    package: `${source}@${slug}`,
    skillId: slug,
    name: stringValue(value.name) || slug,
    installs: numberValue(value.installs),
    source,
    sourceType: stringValue(value.sourceType) || undefined,
    installUrl: stringValue(value.installUrl) || undefined,
    url: stringValue(value.url) || undefined,
    isDuplicate: value.isDuplicate === true,
  };
}

export function skillDetailPath(id: string): string {
  return id.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

export function readSkillContent(detail: SkillsShDetail): string | null {
  if (!Array.isArray(detail.files)) return null;
  const file = detail.files.find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const path = (entry as { path?: unknown }).path;
    return typeof path === "string" && path.toLowerCase() === "skill.md";
  }) as { contents?: unknown } | undefined;
  return typeof file?.contents === "string" ? file.contents : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
