'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowSquareOut } from '@phosphor-icons/react';

import type {
  AppServerPendingRequest,
  AppServerRequestResponseInput,
  AppServerUserInputRequest,
} from '@/codex-web/approval-adapter';
import type { McpServerElicitationRequestParams } from '@/codex/protocol/generated/v2/McpServerElicitationRequestParams';
import {
  buildMcpElicitationAcceptInput,
  buildToolUserInputResponseInput,
  formatAutoResolutionRemaining,
  getToolUserInputAutoResolutionTiming,
  initialMcpFormValues,
  normalizeMcpFormFields,
  type McpFormField,
  type McpFormValue,
} from '@/codex-web/server-request-form-adapter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

type Props = {
  request: AppServerPendingRequest | null | undefined;
  onRespond: (input: AppServerRequestResponseInput) => Promise<void>;
};

export function AppServerRequestPrompt({ request, onRespond }: Props) {
  if (!request || !isUserInputRequest(request)) return null;
  return (
    <AppServerUserInputPrompt
      key={`${typeof request.requestId}:${String(request.requestId)}`}
      request={request}
      onRespond={onRespond}
    />
  );
}

function AppServerUserInputPrompt({
  request,
  onRespond,
}: {
  request: AppServerUserInputRequest;
  onRespond: Props['onRespond'];
}) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (input: AppServerRequestResponseInput) => {
    setError('');
    setSubmitting(true);
    try {
      await onRespond(input);
    } catch (responseError) {
      setError(responseError instanceof Error ? responseError.message : String(responseError));
      setSubmitting(false);
    }
  };

  return (
    <section
      className="mx-auto max-h-[55vh] w-full max-w-3xl overflow-y-auto border-t border-border bg-background px-4 py-4"
      aria-label={t('serverRequest.title')}
      data-testid="app-server-request-prompt"
      data-request-method={request.method}
    >
      {request.method === 'item/tool/requestUserInput' ? (
        <ToolUserInputForm request={request} disabled={submitting} onSubmit={submit} />
      ) : (
        <McpElicitationForm request={request} disabled={submitting} onSubmit={submit} />
      )}
      {error && <p className="mt-3 text-xs text-destructive" role="alert">{error}</p>}
    </section>
  );
}

function ToolUserInputForm({
  request,
  disabled,
  onSubmit,
}: {
  request: Extract<AppServerUserInputRequest, { method: 'item/tool/requestUserInput' }>;
  disabled: boolean;
  onSubmit: (input: AppServerRequestResponseInput) => void;
}) {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [customActive, setCustomActive] = useState<Record<string, boolean>>({});
  const [autoResolutionSnoozed, setAutoResolutionSnoozed] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const startedAtMsRef = useRef(nowMs);
  const autoSubmitStartedRef = useRef(false);

  const autoResolutionTiming = getToolUserInputAutoResolutionTiming(
    request.params.autoResolutionMs,
    startedAtMsRef.current,
    nowMs,
    autoResolutionSnoozed,
  );

  useEffect(() => {
    if (request.params.autoResolutionMs === null || autoResolutionSnoozed) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [autoResolutionSnoozed, request.params.autoResolutionMs]);

  useEffect(() => {
    if (autoResolutionTiming.phase !== 'due' || autoSubmitStartedRef.current) return;
    autoSubmitStartedRef.current = true;
    onSubmit({ type: 'userInput', answers: {} });
  }, [autoResolutionTiming.phase, onSubmit]);

  const snoozeAutoResolution = () => {
    if (request.params.autoResolutionMs !== null) {
      setAutoResolutionSnoozed(true);
    }
  };

  const responseDraft = useMemo(() => {
    const next = { ...answers };
    for (const question of request.params.questions) {
      if (customActive[question.id]) {
        next[question.id] = [customAnswers[question.id] ?? ''];
      }
    }
    return next;
  }, [answers, customActive, customAnswers, request.params.questions]);

  const complete = request.params.questions.length > 0 && request.params.questions.every((question) =>
    (responseDraft[question.id] ?? []).some((answer) => answer.trim().length > 0),
  );

  return (
    <div
      className="space-y-4"
      onPointerDownCapture={snoozeAutoResolution}
      onKeyDownCapture={snoozeAutoResolution}
      onPasteCapture={snoozeAutoResolution}
      onChangeCapture={snoozeAutoResolution}
    >
      <div>
        <p className="text-sm font-medium">{t('serverRequest.userInput.title')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('serverRequest.userInput.description')}</p>
        {autoResolutionTiming.phase === 'visibleCountdown' && (
          <p className="mt-1 text-xs text-destructive" data-testid="request-user-input-auto-resolution-countdown">
            {t('serverRequest.userInput.autoResolutionCountdown', {
              remaining: formatAutoResolutionRemaining(autoResolutionTiming.remainingMs),
            })}
          </p>
        )}
      </div>
      {request.params.questions.map((question) => {
        const selected = answers[question.id]?.[0];
        const showCustom = customActive[question.id] || !question.options?.length;
        return (
          <fieldset key={question.id} className="space-y-2" disabled={disabled}>
            <legend className="text-sm font-medium">
              <span className="mr-2 text-[11px] text-muted-foreground">{question.header}</span>
              {question.question}
            </legend>
            {!!question.options?.length && (
              <div className="grid gap-2 sm:grid-cols-2">
                {question.options.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className={cn(
                      'min-h-14 rounded-md border px-3 py-2 text-left transition-colors',
                      selected === option.label && !customActive[question.id]
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-background hover:bg-muted',
                    )}
                    aria-pressed={selected === option.label && !customActive[question.id]}
                    onClick={() => {
                      snoozeAutoResolution();
                      setAnswers((current) => ({ ...current, [question.id]: [option.label] }));
                      setCustomActive((current) => ({ ...current, [question.id]: false }));
                    }}
                  >
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>
                  </button>
                ))}
                {question.isOther && (
                  <button
                    type="button"
                    className={cn(
                      'min-h-14 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                      customActive[question.id]
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-background hover:bg-muted',
                    )}
                    aria-pressed={!!customActive[question.id]}
                    onClick={() => {
                      snoozeAutoResolution();
                      setCustomActive((current) => ({ ...current, [question.id]: true }));
                    }}
                  >
                    {t('serverRequest.other')}
                  </button>
                )}
              </div>
            )}
            {showCustom && (
              <Input
                type={question.isSecret ? 'password' : 'text'}
                value={customAnswers[question.id] ?? ''}
                placeholder={t('serverRequest.answerPlaceholder')}
                aria-label={question.question}
                autoComplete="off"
                onChange={(event) => {
                  snoozeAutoResolution();
                  const value = event.target.value;
                  setCustomAnswers((current) => ({ ...current, [question.id]: value }));
                  setCustomActive((current) => ({ ...current, [question.id]: true }));
                }}
              />
            )}
          </fieldset>
        );
      })}
      <Button
        size="sm"
        disabled={disabled || !complete}
        data-testid="request-user-input-submit"
        onClick={() => onSubmit(buildToolUserInputResponseInput(request.params, responseDraft))}
      >
        {disabled ? t('serverRequest.submitting') : t('serverRequest.submit')}
      </Button>
    </div>
  );
}

function McpElicitationForm({
  request,
  disabled,
  onSubmit,
}: {
  request: Extract<AppServerUserInputRequest, { method: 'mcpServer/elicitation/request' }>;
  disabled: boolean;
  onSubmit: (input: AppServerRequestResponseInput) => void;
}) {
  const { t } = useTranslation();
  const params = request.params;

  if (params.mode === 'url') {
    return (
      <McpRequestFrame serverName={params.serverName} message={params.message}>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={params.url} target="_blank" rel="noreferrer">
              <ArrowSquareOut />
              {t('serverRequest.mcp.openLink')}
            </a>
          </Button>
          <Button size="sm" variant="outline" disabled={disabled} data-testid="mcp-elicitation-decline" onClick={() => onSubmit({ type: 'elicitation', action: 'decline' })}>
            {t('serverRequest.decline')}
          </Button>
          <Button size="sm" variant="outline" disabled={disabled} data-testid="mcp-elicitation-cancel" onClick={() => onSubmit({ type: 'elicitation', action: 'cancel' })}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" disabled={disabled} onClick={() => onSubmit({ type: 'elicitation', action: 'accept', content: null, _meta: params._meta })}>
            {t('serverRequest.continue')}
          </Button>
        </div>
      </McpRequestFrame>
    );
  }

  if (params.mode === 'openai/form') {
    return (
      <McpRequestFrame serverName={params.serverName} message={params.message}>
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t('serverRequest.mcp.unsupportedForm')}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={disabled} data-testid="mcp-elicitation-decline" onClick={() => onSubmit({ type: 'elicitation', action: 'decline' })}>
            {t('serverRequest.decline')}
          </Button>
          <Button size="sm" variant="outline" disabled={disabled} data-testid="mcp-elicitation-cancel" onClick={() => onSubmit({ type: 'elicitation', action: 'cancel' })}>
            {t('common.cancel')}
          </Button>
        </div>
      </McpRequestFrame>
    );
  }

  return <TypedMcpForm params={params} disabled={disabled} onSubmit={onSubmit} />;
}

function TypedMcpForm({
  params,
  disabled,
  onSubmit,
}: {
  params: Extract<McpServerElicitationRequestParams, { mode: 'form' }>;
  disabled: boolean;
  onSubmit: (input: AppServerRequestResponseInput) => void;
}) {
  const { t } = useTranslation();
  const fields = useMemo(() => normalizeMcpFormFields(params), [params]);
  const [values, setValues] = useState<Record<string, McpFormValue>>(() => initialMcpFormValues(params));
  const [validationError, setValidationError] = useState('');

  const accept = () => {
    try {
      setValidationError('');
      onSubmit(buildMcpElicitationAcceptInput(params, values));
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <McpRequestFrame serverName={params.serverName} message={params.message}>
      <div className="space-y-3">
        {fields.map((field) => (
          <McpField
            key={field.id}
            field={field}
            value={values[field.id]}
            disabled={disabled}
            onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
          />
        ))}
      </div>
      {validationError && <p className="text-xs text-destructive" role="alert">{validationError}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={disabled} data-testid="mcp-elicitation-decline" onClick={() => onSubmit({ type: 'elicitation', action: 'decline' })}>
          {t('serverRequest.decline')}
        </Button>
        <Button size="sm" variant="outline" disabled={disabled} data-testid="mcp-elicitation-cancel" onClick={() => onSubmit({ type: 'elicitation', action: 'cancel' })}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" disabled={disabled} data-testid="mcp-elicitation-submit" onClick={accept}>
          {disabled ? t('serverRequest.submitting') : t('serverRequest.submit')}
        </Button>
      </div>
    </McpRequestFrame>
  );
}

function McpRequestFrame({
  serverName,
  message,
  children,
}: {
  serverName: string;
  message: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">{t('serverRequest.mcp.title', { server: serverName })}</p>
        <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{message}</p>
      </div>
      {children}
    </div>
  );
}

function McpField({
  field,
  value,
  disabled,
  onChange,
}: {
  field: McpFormField;
  value: McpFormValue | undefined;
  disabled: boolean;
  onChange: (value: McpFormValue) => void;
}) {
  const label = (
    <span className="text-xs font-medium">
      {field.label}{field.required ? ' *' : ''}
    </span>
  );

  if (field.kind === 'boolean') {
    return (
      <div className="space-y-1.5">
        {label}
        <div className="flex gap-2">
          {[true, false].map((option) => (
            <Button
              key={String(option)}
              type="button"
              size="sm"
              variant={value === option ? 'default' : 'outline'}
              disabled={disabled}
              aria-pressed={value === option}
              onClick={() => onChange(option)}
            >
              {option ? 'True' : 'False'}
            </Button>
          ))}
        </div>
        {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
      </div>
    );
  }

  if (field.kind === 'single') {
    return (
      <label className="block space-y-1.5">
        {label}
        <Select value={typeof value === 'string' ? value : undefined} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger className="w-full rounded-md border-border bg-background">
            <SelectValue placeholder={field.label} />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
      </label>
    );
  }

  if (field.kind === 'multi') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="space-y-1.5" disabled={disabled}>
        <legend>{label}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {field.options?.map((option) => (
            <label key={option.value} className="flex min-h-9 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={(event) => onChange(event.target.checked
                  ? [...selected, option.value]
                  : selected.filter((item) => item !== option.value))}
              />
              {option.label}
            </label>
          ))}
        </div>
        {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
      </fieldset>
    );
  }

  const inputType = field.kind === 'number'
    ? 'number'
    : field.format === 'email'
      ? 'email'
      : field.format === 'uri'
        ? 'url'
        : field.format === 'date'
          ? 'date'
          : field.format === 'date-time'
            ? 'datetime-local'
            : 'text';
  return (
    <label className="block space-y-1.5">
      {label}
      <Input
        type={inputType}
        value={typeof value === 'string' || typeof value === 'number' ? value : ''}
        disabled={disabled}
        required={field.required}
        min={field.minimum}
        max={field.maximum}
        minLength={field.minLength}
        maxLength={field.maxLength}
        step={field.integer ? 1 : undefined}
        onChange={(event) => onChange(field.kind === 'number'
          ? event.target.value === '' ? '' : Number(event.target.value)
          : event.target.value)}
      />
      {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
    </label>
  );
}

function isUserInputRequest(request: AppServerPendingRequest): request is AppServerUserInputRequest {
  return request.method === 'item/tool/requestUserInput' || request.method === 'mcpServer/elicitation/request';
}
