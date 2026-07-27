import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nContext } from "@/components/layout/I18nProvider";
import { translate } from "@/i18n";
import { NewChatProjectSelector } from "@/components/chat/NewChatProjectSelector";

const i18nValue = {
  locale: "zh" as const,
  setLocale: () => undefined,
  t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
    translate("zh", key, params),
};

function renderSelector(currentProject: string) {
  return renderToStaticMarkup(
    <I18nContext.Provider value={i18nValue}>
      <NewChatProjectSelector
        currentProject={currentProject}
        projects={["/repo/Chat", "/repo/web"]}
        onSelectProject={() => undefined}
        onClearProject={() => undefined}
        onCreateProject={() => undefined}
      />
    </I18nContext.Provider>,
  );
}

describe("NewChatProjectSelector", () => {
  it("显示当前项目并提供独立的清除按钮", () => {
    const html = renderSelector("/repo/Chat");

    expect(html).toContain('data-testid="new-chat-project-selector"');
    expect(html).toContain('data-current-project="/repo/Chat"');
    expect(html).toContain(">Chat<");
    expect(html).toContain('aria-label="清除当前项目"');
  });

  it("没有当前项目时显示选择项目入口", () => {
    const html = renderSelector("");

    expect(html).toContain("选择项目");
    expect(html).not.toContain('aria-label="清除当前项目"');
  });
});
