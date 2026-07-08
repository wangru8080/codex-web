'use client';

/**
 * WorkspaceSidebar — inner Tab content only.
 *
 * Phase 7c-C — the card chrome (ResizeHandle, CardFrame, CardSurface,
 * open guard, width state read) lives in AppShell.ChatContentRow now.
 * This component is responsible only for rendering the TabBar + the
 * active Tab's content. AppShell decides whether to mount it, supplies
 * the surrounding CardFrame width via the WorkspaceSidebar context's
 * `state.width`, and owns the ResizeHandle wiring.
 *
 * This keeps width state with the panel's own context (per Phase 7c
 * decision D-2) while the layout primitives stay generic.
 */

import { TabBar } from './TabBar';
import { TabPanel } from './TabPanel';

export function WorkspaceSidebar() {
  return (
    <>
      <TabBar />
      <TabPanel />
    </>
  );
}
