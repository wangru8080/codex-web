/**
 * builtin-tools/dashboard.ts — Dashboard widget management tools (shared).
 */

import { tool } from 'ai';
import { z } from 'zod';

export const DASHBOARD_SYSTEM_PROMPT = `<dashboard-capability>
You can manage the project dashboard using these tools:
- codepilot_dashboard_pin: Pin a widget to the dashboard
- codepilot_dashboard_list: List all pinned widgets
- codepilot_dashboard_refresh: Read source data for a widget
- codepilot_dashboard_update: Update a widget's code/title
- codepilot_dashboard_remove: Remove a widget
</dashboard-capability>`;

export function createDashboardTools(workDir?: string) {
  const cwd = workDir || process.cwd();
  return {
    codepilot_dashboard_pin: tool({
      description: 'Pin a widget to the project dashboard.',
      inputSchema: z.object({
        widgetCode: z.string().describe('HTML code for the widget'),
        title: z.string().describe('Widget title'),
        dataContract: z.string().describe('Description of what data the widget displays'),
        dataSourceType: z.enum(['file', 'mcp_tool', 'cli']).describe('Data source type'),
        dataSourcePaths: z.array(z.string()).optional(),
        cliCommand: z.string().optional(),
      }),
      execute: async ({ widgetCode, title, dataContract, dataSourceType, dataSourcePaths, cliCommand }) => {
        try {
          const { addWidget, generateWidgetId } = await import('@/lib/dashboard-store');
          const id = generateWidgetId();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await addWidget(cwd, { id, widgetCode, title, dataContract, dataSourceType, dataSourcePaths, cliCommand } as any);
          return `Widget "${title}" pinned to dashboard (id: ${id})`;
        } catch (err) { return `Failed: ${err instanceof Error ? err.message : 'unknown'}`; }
      },
    }),

    codepilot_dashboard_list: tool({
      description: 'List all widgets pinned to the project dashboard.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const { readDashboard } = await import('@/lib/dashboard-store');
          const db = await readDashboard(cwd);
          const widgets = db?.widgets || [];
          if (widgets.length === 0) return 'No widgets pinned to dashboard.';
          return widgets.map((w: { id: string; title: string }) => `- ${w.title} (${w.id})`).join('\n');
        } catch (err) { return `Failed: ${err instanceof Error ? err.message : 'unknown'}`; }
      },
    }),

    codepilot_dashboard_refresh: tool({
      description: 'Read source data for a dashboard widget.',
      inputSchema: z.object({ widgetId: z.string() }),
      execute: async ({ widgetId }) => {
        try {
          const { readDashboard } = await import('@/lib/dashboard-store');
          const { resolveGlobs, readSourceFiles } = await import('@/lib/dashboard-file-reader');
          const db = await readDashboard(cwd);
          const widget = db?.widgets?.find((w: { id: string }) => w.id === widgetId);
          if (!widget) return `Widget ${widgetId} not found.`;
          if (widget.dataSource?.type === 'file' && widget.dataSource?.paths) {
            const files = await resolveGlobs(cwd, widget.dataSource.paths);
            const content = await readSourceFiles(cwd, files);
            return content;
          }
          return `Widget uses ${widget.dataSource?.type || 'unknown'} data source. Call the appropriate tool to refresh.`;
        } catch (err) { return `Failed: ${err instanceof Error ? err.message : 'unknown'}`; }
      },
    }),

    codepilot_dashboard_update: tool({
      description: 'Update a dashboard widget code, title, or data contract.',
      inputSchema: z.object({
        widgetId: z.string(),
        widgetCode: z.string().optional(),
        title: z.string().optional(),
        dataContract: z.string().optional(),
      }),
      execute: async ({ widgetId, widgetCode, title, dataContract }) => {
        try {
          const { readDashboard, updateWidget } = await import('@/lib/dashboard-store');
          const db = await readDashboard(cwd);
          if (!db?.widgets?.find((w: { id: string }) => w.id === widgetId)) return `Widget ${widgetId} not found.`;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await updateWidget(cwd, widgetId, { widgetCode, title, dataContract } as any);
          return `Widget ${widgetId} updated.`;
        } catch (err) { return `Failed: ${err instanceof Error ? err.message : 'unknown'}`; }
      },
    }),

    codepilot_dashboard_remove: tool({
      description: 'Remove a widget from the project dashboard.',
      inputSchema: z.object({ widgetId: z.string() }),
      execute: async ({ widgetId }) => {
        try {
          const { removeWidget } = await import('@/lib/dashboard-store');
          await removeWidget(cwd, widgetId);
          return `Widget ${widgetId} removed.`;
        } catch (err) { return `Failed: ${err instanceof Error ? err.message : 'unknown'}`; }
      },
    }),
  };
}
