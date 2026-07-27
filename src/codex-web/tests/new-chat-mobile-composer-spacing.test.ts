import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('新对话移动端输入框间距', () => {
  it.each([
    'src/app/chat/page.tsx',
    'src/components/chat/ChatView.tsx',
  ])('%s 不重复叠加手机端横向内边距', (path) => {
    expect(source(path)).toContain(
      'items-center justify-center px-0 py-8 sm:px-4',
    );
  });
});
