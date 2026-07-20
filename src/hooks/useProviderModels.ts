import { useMemo } from 'react';
import type { ProviderModelGroup } from '@/types';
import { useAppServerState } from '@/codex-web/AppServerProvider';
import {
  appServerModelsToProviderGroup,
  CODEX_ACCOUNT_PROVIDER_ID,
} from '@/codex-web/app-server-model-groups';
import { findModelOption } from '@/lib/model-option-match';

export { findModelOption };

export interface DefaultModelOption {
  value: string;
  label: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
}

export const DEFAULT_MODEL_OPTIONS: DefaultModelOption[] = [];

export function isComposerProviderLoading(
  fetchState: 'idle' | 'loaded' | 'failed',
  hasResolvedModel: boolean,
): boolean {
  return fetchState === 'idle' && !hasResolvedModel;
}

export interface UseProviderModelsReturn {
  providerGroups: ProviderModelGroup[];
  runtimeApplied?: 'codex_runtime';
  currentProviderIdValue: string;
  modelOptions: DefaultModelOption[];
  currentModelOption: DefaultModelOption | undefined;
  globalDefaultModel: string | undefined;
  globalDefaultProvider: string | undefined;
  noCompatibleProvider: boolean;
  fetchState: 'idle' | 'loaded' | 'failed';
  resolvedProviderId: string;
  resolvedModel: string;
  providerWasFilteredOut: boolean;
}

export function useProviderModels(
  _providerId: string | undefined,
  modelName: string | undefined,
  _runtime?: unknown,
  _options?: unknown,
): UseProviderModelsReturn {
  const appServerState = useAppServerState();
  const group = useMemo(
    () => appServerModelsToProviderGroup(appServerState.models?.data),
    [appServerState.models],
  );
  const providerGroups = useMemo(() => group ? [group] : [], [group]);
  const modelOptions = group?.models ?? [];
  const currentModelOption = findModelOption(modelOptions, modelName) ?? modelOptions[0];
  const connected = appServerState.connection.data === 'connected';

  return {
    providerGroups,
    runtimeApplied: 'codex_runtime',
    currentProviderIdValue: CODEX_ACCOUNT_PROVIDER_ID,
    modelOptions,
    currentModelOption,
    globalDefaultModel: modelOptions[0]?.value,
    globalDefaultProvider: CODEX_ACCOUNT_PROVIDER_ID,
    noCompatibleProvider: connected && modelOptions.length === 0,
    fetchState: connected ? 'loaded' : 'idle',
    resolvedProviderId: CODEX_ACCOUNT_PROVIDER_ID,
    resolvedModel: currentModelOption?.value ?? '',
    providerWasFilteredOut: false,
  };
}
