'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowSquareOut } from '@/components/ui/icon';
import { ArrowRight, Clock3, Pencil, X } from 'lucide-react';

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
      className={cn(
        'mx-auto mb-2 max-h-[55vh] w-[calc(100%-1rem)] max-w-3xl overflow-y-auto bg-background',
        request.method === 'item/tool/requestUserInput'
          ? 'rounded-lg border border-border/70 shadow-[var(--shadow-diffuse)]'
          : 'border-t border-border px-4 py-4',
      )}
      aria-label={t('serverRequest.title')}
      data-testid="app-server-request-prompt"
      data-request-method={request.method}
    >
      {request.method === 'item/tool/requestUserInput' ? (
        <ToolUserInputForm request={request} disabled={submitting} onSubmit={submit} />
      ) : (
        <McpElicitationForm request={request} disabled={submitting} onSubmit={submit} />
      )}
      {error && (
        <p className={cn('text-xs text-destructive', request.method === 'item/tool/requestUserInput' ? 'mx-6 mb-3' : 'mt-3')} role="alert">
          {error}
        </p>
      )}
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
  const [customActive, setCustomActive] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
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

  const question = request.params.questions[questionIndex];
  const isLastQuestion = questionIndex === request.params.questions.length - 1;

  const answerQuestion = (value: string) => {
    if (!question || disabled || !value.trim()) return;
    const nextAnswers = { ...answers, [question.id]: [value] };
    if (isLastQuestion) {
      onSubmit(buildToolUserInputResponseInput(request.params, nextAnswers));
      return;
    }
    setAnswers(nextAnswers);
    setCustomActive(false);
    setQuestionIndex((current) => current + 1);
  };

  const skip = () => onSubmit({ type: 'userInput', answers: {} });

  return (
    <div
      onPointerDownCapture={snoozeAutoResolution}
      onKeyDownCapture={snoozeAutoResolution}
      onPasteCapture={snoozeAutoResolution}
      onChangeCapture={snoozeAutoResolution}
    >
      <header className="flex min-h-16 items-start gap-3 px-4 py-4 sm:px-6">
        <div className="min-w-0 flex-1">
          {request.params.questions.length > 1 && question && (
            <p className="mb-1 text-xs text-muted-foreground">
              {question.header} · {questionIndex + 1}/{request.params.questions.length}
            </p>
          )}
          <h2 className="text-base font-semibold leading-6">
            {question?.question ?? t('serverRequest.userInput.title')}
          </h2>
        </div>
        {autoResolutionTiming.phase === 'visibleCountdown' && (
          <div
            className="mt-0.5 flex shrink-0 items-center gap-1.5 text-xs font-medium text-destructive"
            data-testid="request-user-input-auto-resolution-countdown"
            role="status"
          >
            <Clock3 className="size-3.5" aria-hidden="true" />
            {t('serverRequest.userInput.autoResolutionCountdown', {
              remaining: formatAutoResolutionRemaining(autoResolutionTiming.remainingMs),
            })}
          </div>
        )}
        <button
          type="button"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t('common.close')}
          disabled={disabled}
          data-testid="request-user-input-close"
          onClick={skip}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      {question && (
        <fieldset className="px-3 pb-2 sm:px-4" disabled={disabled}>
          <legend className="sr-only">{question.question}</legend>
          <div className="space-y-1">
            {question.options?.map((option, optionIndex) => (
              <button
                key={option.label}
                type="button"
                className={cn(
                  'group flex min-h-14 w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted',
                  optionIndex === 0 && 'bg-muted/80',
                )}
                onClick={() => answerQuestion(option.label)}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background text-sm text-muted-foreground">
                  {optionIndex + 1}
                </span>
                <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-3">
                  <span className="block text-sm font-medium text-foreground">{option.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground sm:mt-0">{option.description}</span>
                </span>
                <ArrowRight
                  className={cn('size-5 shrink-0 text-muted-foreground transition-opacity', optionIndex === 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <footer className="flex min-h-14 items-center gap-2 border-t border-border/60 px-4 py-2 sm:px-6">
        {question?.isOther || !question?.options?.length ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Pencil className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {customActive || !question?.options?.length ? (
              <>
                <Input
                  className="h-9 border-0 px-0 shadow-none focus-visible:ring-0"
                  type={question?.isSecret ? 'password' : 'text'}
                  value={question ? customAnswers[question.id] ?? '' : ''}
                  placeholder={t('serverRequest.answerPlaceholder')}
                  aria-label={question?.question ?? t('serverRequest.answerPlaceholder')}
                  autoComplete="off"
                  autoFocus
                  disabled={disabled || !question}
                  data-testid="request-user-input-custom-answer"
                  onChange={(event) => {
                    if (!question) return;
                    setCustomAnswers((current) => ({ ...current, [question.id]: event.target.value }));
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || !question) return;
                    event.preventDefault();
                    answerQuestion(customAnswers[question.id] ?? '');
                  }}
                />
                <button
                  type="button"
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                  aria-label={t('serverRequest.submit')}
                  disabled={disabled || !question || !(customAnswers[question.id] ?? '').trim()}
                  data-testid="request-user-input-submit"
                  onClick={() => answerQuestion(customAnswers[question.id] ?? '')}
                >
                  <ArrowRight className="size-4" aria-hidden="true" />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-sm text-muted-foreground hover:text-foreground"
                data-testid="request-user-input-other"
                onClick={() => {
                  snoozeAutoResolution();
                  setCustomActive(true);
                }}
              >
                {t('serverRequest.otherPrompt')}
              </button>
            )}
          </div>
        ) : <div className="flex-1" />}
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          data-testid="request-user-input-skip"
          onClick={skip}
        >
          {t('serverRequest.skip')}
        </Button>
      </footer>
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
