import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CodexWebIcon } from './semantic-icon';

describe('CodexWebIcon', () => {
  it('默认使用 2 像素描边', () => {
    const html = renderToStaticMarkup(<CodexWebIcon name="folder" aria-hidden />);

    expect(html).toContain('stroke-width="2"');
  });

  it('保留调用方显式指定的描边宽度', () => {
    const html = renderToStaticMarkup(
      <CodexWebIcon name="folder" strokeWidth={1.5} aria-hidden />,
    );

    expect(html).toContain('stroke-width="1.5"');
  });
});
