import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { I18nContext } from '@/components/layout/I18nProvider';
import { translate } from '@/i18n';

import { ContextCompactionRow } from './ContextCompactionRow';

const i18nValue = {
  locale: 'zh' as const,
  setLocale: () => undefined,
  t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
    translate('zh', key, params),
};

describe('ContextCompactionRow', () => {
  it('渲染进行中的自动压缩状态与 started 来源', () => {
    const html = renderToStaticMarkup(
      <I18nContext.Provider value={i18nValue}>
        <ContextCompactionRow
          block={{
            type: 'codex_context_compaction',
            status: 'inProgress',
            sourceBreadcrumb: 'app-server.item/started',
          }}
        />
      </I18nContext.Provider>,
    );

    expect(html).toContain('上下文开始压缩');
    expect(html).toContain('data-context-compaction-status="inProgress"');
    expect(html).toContain('data-source-breadcrumb="app-server.item/started"');
  });

  it('渲染已完成的自动压缩状态与 completed 来源', () => {
    const html = renderToStaticMarkup(
      <I18nContext.Provider value={i18nValue}>
        <ContextCompactionRow
          block={{
            type: 'codex_context_compaction',
            status: 'completed',
            sourceBreadcrumb: 'app-server.item/completed',
          }}
        />
      </I18nContext.Provider>,
    );

    expect(html).toContain('上下文已压缩');
    expect(html).toContain('data-context-compaction-status="completed"');
    expect(html).toContain('data-source-breadcrumb="app-server.item/completed"');
  });
});
