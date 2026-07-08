"use client";

/**
 * Form fields + validation for adding/editing an external MCP server.
 *
 * Headless wrapper — renders only the form body (name + form/JSON
 * toggle + per-transport fields + env/headers + error line). The
 * parent supplies its own Save / Cancel buttons and calls
 * `formRef.current?.submit()` to trigger validation; the form invokes
 * `onSave(name, server)` only when validation passes.
 *
 * Used by:
 *   - <McpServerEditor>          — add-server Dialog (toolbar entry)
 *   - <McpServerDetailDialog>    — in-place edit view (card click)
 *
 * Both wrappers want different button placement / labels, so the
 * footer is intentionally NOT part of this component.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WifiHigh } from '@/components/ui/icon';
import { CodexWebIcon } from '@/components/ui/semantic-icon';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import type { MCPServer } from '@/types';

type ServerType = 'stdio' | 'sse' | 'http';

export interface McpServerEditorFormHandle {
  /** Validate inputs and call onSave when valid. Returns true on success. */
  submit: () => boolean;
}

export interface McpServerEditorFormProps {
  initialName?: string;
  initialServer?: MCPServer;
  onSave: (name: string, server: MCPServer) => void;
  /** When true the name input is read-only — name is the persistence key when editing. */
  isEditing?: boolean;
  /** Bump to force a state reset (e.g., re-opening with new initial data). */
  resetKey?: number | string;
}

export const McpServerEditorForm = forwardRef<McpServerEditorFormHandle, McpServerEditorFormProps>(
  function McpServerEditorForm(
    { initialName, initialServer, onSave, isEditing = false, resetKey },
    ref,
  ) {
    const { t } = useTranslation();
    const [name, setName] = useState(initialName || '');
    const [serverType, setServerType] = useState<ServerType>(initialServer?.type || 'stdio');
    const [command, setCommand] = useState(initialServer?.command || '');
    const [args, setArgs] = useState(initialServer?.args?.join('\n') || '');
    const [url, setUrl] = useState(initialServer?.url || '');
    const [headersText, setHeadersText] = useState(
      initialServer?.headers ? JSON.stringify(initialServer.headers, null, 2) : '{}',
    );
    const [envText, setEnvText] = useState(
      initialServer?.env ? JSON.stringify(initialServer.env, null, 2) : '{}',
    );
    const [jsonMode, setJsonMode] = useState(false);
    const [jsonText, setJsonText] = useState(
      initialServer
        ? JSON.stringify(initialServer, null, 2)
        : '{\n  "command": "",\n  "args": []\n}',
    );
    const [error, setError] = useState<string | null>(null);

    /* eslint-disable react-hooks/set-state-in-effect -- intentional: caller bumps resetKey to reset form */
    useEffect(() => {
      setName(initialName || '');
      setServerType(initialServer?.type || 'stdio');
      setCommand(initialServer?.command || '');
      setArgs(initialServer?.args?.join('\n') || '');
      setUrl(initialServer?.url || '');
      setHeadersText(
        initialServer?.headers ? JSON.stringify(initialServer.headers, null, 2) : '{}',
      );
      setEnvText(
        initialServer?.env ? JSON.stringify(initialServer.env, null, 2) : '{}',
      );
      setJsonMode(false);
      setJsonText(
        initialServer
          ? JSON.stringify(initialServer, null, 2)
          : '{\n  "command": "",\n  "args": []\n}',
      );
      setError(null);
      // We deliberately depend on resetKey + initial props so changing
      // either re-seeds the form. Adding the setters as deps is noise.
    }, [resetKey, initialName, initialServer]);
    /* eslint-enable react-hooks/set-state-in-effect */

    const handleSubmit = useCallback((): boolean => {
      setError(null);

      if (!name.trim()) {
        setError(t('mcp.editor.error.nameRequired' as TranslationKey));
        return false;
      }

      if (jsonMode) {
        try {
          const parsed = JSON.parse(jsonText);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            setError(t('mcp.editor.error.jsonNotObject' as TranslationKey));
            return false;
          }
          onSave(name.trim(), parsed as MCPServer);
          return true;
        } catch {
          setError(t('mcp.editor.error.jsonInvalid' as TranslationKey));
          return false;
        }
      }

      if (serverType === 'stdio') {
        if (!command.trim()) {
          setError(t('mcp.editor.error.commandRequired' as TranslationKey));
          return false;
        }
      } else {
        if (!url.trim()) {
          setError(t('mcp.editor.error.urlRequired' as TranslationKey));
          return false;
        }
      }

      let env: Record<string, string> | undefined;
      try {
        const parsed = JSON.parse(envText);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          env = Object.keys(parsed).length > 0 ? parsed : undefined;
        } else {
          setError(t('mcp.editor.error.envNotObject' as TranslationKey));
          return false;
        }
      } catch {
        setError(t('mcp.editor.error.envInvalidJson' as TranslationKey));
        return false;
      }

      let headers: Record<string, string> | undefined;
      if (serverType !== 'stdio') {
        try {
          const parsed = JSON.parse(headersText);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            headers = Object.keys(parsed).length > 0 ? parsed : undefined;
          } else {
            setError(t('mcp.editor.error.headersNotObject' as TranslationKey));
            return false;
          }
        } catch {
          setError(t('mcp.editor.error.headersInvalidJson' as TranslationKey));
          return false;
        }
      }

      const serverArgs = args
        .split('\n')
        .map((s: string) => s.trim())
        .filter(Boolean);

      const server: MCPServer = serverType === 'stdio'
        ? {
            command: command.trim(),
            ...(serverArgs.length > 0 ? { args: serverArgs } : {}),
            ...(env ? { env } : {}),
          }
        : {
            type: serverType,
            ...(url ? { url: url.trim() } : {}),
            ...(serverArgs.length > 0 ? { args: serverArgs } : {}),
            ...(env ? { env } : {}),
            ...(headers ? { headers } : {}),
          };

      onSave(name.trim(), server);
      return true;
    }, [name, jsonMode, jsonText, serverType, command, url, envText, headersText, args, onSave, t]);

    useImperativeHandle(ref, () => ({ submit: handleSubmit }), [handleSubmit]);

    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="server-name">{t('mcp.serverName')}</Label>
          <Input
            id="server-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="my-mcp-server"
            disabled={isEditing}
          />
        </div>

        <div className="flex items-center gap-2">
          <Label className="shrink-0">{t('mcp.editor.editMode' as TranslationKey)}:</Label>
          <Button
            variant={jsonMode ? 'outline' : 'default'}
            size="sm"
            onClick={() => {
              setJsonMode(false);
              setError(null);
            }}
          >
            {t('mcp.formTab')}
          </Button>
          <Button
            variant={jsonMode ? 'default' : 'outline'}
            size="sm"
            className="gap-1.5"
            onClick={() => {
              const currentConfig: Record<string, unknown> = {};
              if (serverType !== 'stdio') {
                currentConfig.type = serverType;
                if (url) currentConfig.url = url;
              } else {
                currentConfig.command = command;
              }
              const argsArr = args.split('\n').map((s) => s.trim()).filter(Boolean);
              if (argsArr.length > 0) currentConfig.args = argsArr;
              try {
                const envParsed = JSON.parse(envText);
                if (Object.keys(envParsed).length > 0) currentConfig.env = envParsed;
              } catch { /* ignore */ }
              try {
                const headersParsed = JSON.parse(headersText);
                if (Object.keys(headersParsed).length > 0) currentConfig.headers = headersParsed;
              } catch { /* ignore */ }
              setJsonText(JSON.stringify(currentConfig, null, 2));
              setJsonMode(true);
              setError(null);
            }}
          >
            <CodexWebIcon name="code" size="sm" aria-hidden />
            {t('mcp.jsonEditTab')}
          </Button>
        </div>

        {jsonMode ? (
          <div className="space-y-2">
            <Label>{t('mcp.editor.serverConfig' as TranslationKey)}</Label>
            <Textarea
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value);
                setError(null);
              }}
              className="font-mono text-sm min-h-[250px]"
              placeholder='{"command": "npx", "args": ["-y", "@server/name"]}'
            />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label>{t('mcp.serverType')}</Label>
              <Tabs
                value={serverType}
                onValueChange={(v) => {
                  setServerType(v as ServerType);
                  setError(null);
                }}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="stdio" className="flex-1 gap-1.5">
                    <CodexWebIcon name="disk" size="sm" aria-hidden />
                    stdio
                  </TabsTrigger>
                  <TabsTrigger value="sse" className="flex-1 gap-1.5">
                    <WifiHigh size={14} />
                    SSE
                  </TabsTrigger>
                  <TabsTrigger value="http" className="flex-1 gap-1.5">
                    <CodexWebIcon name="web_simple" size="sm" aria-hidden />
                    HTTP
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {serverType === 'stdio' ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="server-command">{t('mcp.command')}</Label>
                  <Input
                    id="server-command"
                    value={command}
                    onChange={(e) => {
                      setCommand(e.target.value);
                      setError(null);
                    }}
                    placeholder="npx -y @modelcontextprotocol/server-name"
                    className="font-mono text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="server-args">{t('mcp.argsLabel')}</Label>
                  <Textarea
                    id="server-args"
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                    placeholder={'--flag\nvalue'}
                    className="font-mono text-sm min-h-[80px]"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="server-url">{t('mcp.url')}</Label>
                  <Input
                    id="server-url"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setError(null);
                    }}
                    placeholder={
                      serverType === 'sse'
                        ? 'http://localhost:3001/sse'
                        : 'http://localhost:3001'
                    }
                    className="font-mono text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="server-headers">{t('mcp.headers')}</Label>
                  <Textarea
                    id="server-headers"
                    value={headersText}
                    onChange={(e) => {
                      setHeadersText(e.target.value);
                      setError(null);
                    }}
                    placeholder='{"Authorization": "Bearer ..."}'
                    className="font-mono text-sm min-h-[80px]"
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="server-env">{t('mcp.envVars')}</Label>
              <Textarea
                id="server-env"
                value={envText}
                onChange={(e) => {
                  setEnvText(e.target.value);
                  setError(null);
                }}
                placeholder='{"API_KEY": "..."}'
                className="font-mono text-sm min-h-[80px]"
              />
            </div>
          </>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  },
);
