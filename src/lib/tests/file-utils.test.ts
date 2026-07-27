import { afterEach, describe, expect, it, vi } from 'vitest';

import { dataUrlToFileAttachment } from '../file-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dataUrlToFileAttachment', () => {
  it('从 base64 data URL 提取纯数据和真实大小', async () => {
    const attachment = await dataUrlToFileAttachment(
      'data:image/png;base64,AAAA',
      'image.png',
      'image/png',
    );

    expect(attachment).toMatchObject({
      name: 'image.png',
      type: 'image/png',
      size: 3,
      data: 'AAAA',
    });
  });

  it('读取 blob URL 二进制而不是把 blob 地址当作 base64', async () => {
    const fetchMock = vi.fn(async () => new Response(
      Uint8Array.from([0, 1, 2, 3]),
      { headers: { 'content-type': 'image/png' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const attachment = await dataUrlToFileAttachment(
      'blob:http://localhost/image-id',
      'image.png',
      'image/png',
    );

    expect(fetchMock).toHaveBeenCalledWith('blob:http://localhost/image-id');
    expect(attachment).toMatchObject({
      type: 'image/png',
      size: 4,
      data: 'AAECAw==',
    });
  });
});
