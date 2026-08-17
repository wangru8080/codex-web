'use client';

import dynamic from 'next/dynamic';

const PreviewPanel = dynamic(
  () => import('@/components/layout/panels/PreviewPanel').then((module) => module.PreviewPanel),
  { ssr: false },
);

export function PreviewPanelFrame() {
  return <PreviewPanel variant="sidebar" />;
}
