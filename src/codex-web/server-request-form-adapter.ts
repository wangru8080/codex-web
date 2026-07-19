import type { JsonValue } from "@/codex/protocol/generated/serde_json/JsonValue";
import type { McpServerElicitationRequestParams } from "@/codex/protocol/generated/v2/McpServerElicitationRequestParams";
import type { ToolRequestUserInputParams } from "@/codex/protocol/generated/v2/ToolRequestUserInputParams";

import type { AppServerRequestResponseInput } from "./approval-adapter";

export type McpFormValue = string | number | boolean | string[];

export const AUTO_RESOLUTION_HIDDEN_GRACE_MS = 60_000;
export const AUTO_RESOLUTION_VISIBLE_COUNTDOWN_MS = 60_000;

export type ToolUserInputAutoResolutionTiming =
  | { phase: "disabled" }
  | { phase: "hiddenGrace"; remainingMs: number }
  | { phase: "visibleCountdown"; remainingMs: number }
  | { phase: "due" };

export type McpFormOption = {
  label: string;
  value: string;
};

export type McpFormField = {
  id: string;
  label: string;
  description?: string;
  required: boolean;
  kind: "string" | "number" | "boolean" | "single" | "multi";
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  integer?: boolean;
  options?: McpFormOption[];
  defaultValue?: McpFormValue;
};

export function getToolUserInputAutoResolutionTiming(
  autoResolutionMs: number | null,
  startedAtMs: number,
  nowMs: number,
  snoozed: boolean,
): ToolUserInputAutoResolutionTiming {
  if (autoResolutionMs === null || snoozed) {
    return { phase: "disabled" };
  }

  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  if (elapsedMs < AUTO_RESOLUTION_HIDDEN_GRACE_MS) {
    return {
      phase: "hiddenGrace",
      remainingMs: AUTO_RESOLUTION_HIDDEN_GRACE_MS - elapsedMs,
    };
  }

  const visibleElapsedMs = elapsedMs - AUTO_RESOLUTION_HIDDEN_GRACE_MS;
  if (visibleElapsedMs < AUTO_RESOLUTION_VISIBLE_COUNTDOWN_MS) {
    return {
      phase: "visibleCountdown",
      remainingMs: AUTO_RESOLUTION_VISIBLE_COUNTDOWN_MS - visibleElapsedMs,
    };
  }

  return { phase: "due" };
}

export function formatAutoResolutionRemaining(remainingMs: number): string {
  const seconds = Math.ceil(Math.max(0, remainingMs) / 1_000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
}

export function buildToolUserInputResponseInput(
  params: ToolRequestUserInputParams,
  draft: Record<string, string[]>,
): AppServerRequestResponseInput {
  const answers: Record<string, { answers: string[] }> = {};
  for (const question of params.questions) {
    const values = draft[question.id]
      ?.map((value) => value.trim())
      .filter(Boolean) ?? [];
    if (values.length === 0) {
      throw new Error(`请回答：${question.question}`);
    }
    answers[question.id] = { answers: values };
  }
  return { type: "userInput", answers };
}

export function normalizeMcpFormFields(params: McpServerElicitationRequestParams): McpFormField[] {
  if (params.mode !== "form") {
    throw new Error("MCP elicitation 不是 typed form");
  }

  const required = new Set(params.requestedSchema.required ?? []);
  return Object.entries(params.requestedSchema.properties).map(([id, rawSchema]) => {
    if (!rawSchema) {
      throw new Error(`MCP 表单字段缺少 schema：${id}`);
    }
    const schema = rawSchema as unknown as Record<string, unknown>;
    const label = readString(schema.title) ?? id;
    const base = {
      id,
      label,
      description: readString(schema.description),
      required: required.has(id),
    };

    if (schema.type === "array") {
      const items = readRecord(schema.items);
      const options = readEnumOptions(items);
      return {
        ...base,
        kind: "multi" as const,
        options,
        minItems: readCount(schema.minItems),
        maxItems: readCount(schema.maxItems),
        defaultValue: readStringArray(schema.default),
      };
    }

    if (schema.type === "boolean") {
      return {
        ...base,
        kind: "boolean" as const,
        defaultValue: typeof schema.default === "boolean" ? schema.default : undefined,
      };
    }

    if (schema.type === "number" || schema.type === "integer") {
      return {
        ...base,
        kind: "number" as const,
        integer: schema.type === "integer",
        minimum: readNumber(schema.minimum),
        maximum: readNumber(schema.maximum),
        defaultValue: readNumber(schema.default),
      };
    }

    if (Array.isArray(schema.oneOf) || Array.isArray(schema.enum)) {
      const options = readEnumOptions(schema);
      return {
        ...base,
        kind: "single" as const,
        options,
        defaultValue: readString(schema.default),
      };
    }

    if (schema.type === "string") {
      return {
        ...base,
        kind: "string" as const,
        format: readString(schema.format),
        minLength: readNumber(schema.minLength),
        maxLength: readNumber(schema.maxLength),
        defaultValue: readString(schema.default),
      };
    }

    throw new Error(`MCP 表单字段类型不受支持：${id}`);
  });
}

export function initialMcpFormValues(
  params: McpServerElicitationRequestParams,
): Record<string, McpFormValue> {
  return Object.fromEntries(
    normalizeMcpFormFields(params)
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [field.id, field.defaultValue as McpFormValue]),
  );
}

export function buildMcpElicitationAcceptInput(
  params: McpServerElicitationRequestParams,
  values: Record<string, McpFormValue | undefined>,
): AppServerRequestResponseInput {
  const fields = normalizeMcpFormFields(params);
  const content: Record<string, JsonValue> = {};

  for (const field of fields) {
    const value = values[field.id];
    if (isEmptyValue(value)) {
      if (field.required) {
        throw new Error(`请填写：${field.label}`);
      }
      continue;
    }
    if (value === undefined) continue;

    validateMcpField(field, value);
    content[field.id] = typeof value === "string" ? value.trim() : value;
  }

  return {
    type: "elicitation",
    action: "accept",
    content,
    _meta: params.mode === "form" ? params._meta : null,
  };
}

function validateMcpField(field: McpFormField, value: McpFormValue): void {
  if (field.kind === "string") {
    if (typeof value !== "string") throwInvalid(field);
    const length = value.trim().length;
    if (field.minLength !== undefined && length < field.minLength) throwInvalid(field);
    if (field.maxLength !== undefined && length > field.maxLength) throwInvalid(field);
    return;
  }

  if (field.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) throwInvalid(field);
    if (field.integer && !Number.isInteger(value)) throwInvalid(field);
    if (field.minimum !== undefined && value < field.minimum) throwInvalid(field);
    if (field.maximum !== undefined && value > field.maximum) throwInvalid(field);
    return;
  }

  if (field.kind === "boolean") {
    if (typeof value !== "boolean") throwInvalid(field);
    return;
  }

  const allowed = new Set(field.options?.map((option) => option.value) ?? []);
  if (field.kind === "single") {
    if (typeof value !== "string" || !allowed.has(value)) throwInvalid(field);
    return;
  }

  if (!Array.isArray(value) || value.some((item) => !allowed.has(item))) throwInvalid(field);
  if (field.minItems !== undefined && value.length < field.minItems) throwInvalid(field);
  if (field.maxItems !== undefined && value.length > field.maxItems) throwInvalid(field);
}

function throwInvalid(field: McpFormField): never {
  throw new Error(`字段值无效：${field.label}`);
}

function readEnumOptions(schema: Record<string, unknown>): McpFormOption[] {
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.map((entry) => {
      const option = readRecord(entry);
      const value = readString(option.const);
      if (value === undefined) throw new Error("MCP 枚举选项缺少 const");
      return { value, label: readString(option.title) ?? value };
    });
  }

  const enumValues = readStringArray(schema.enum) ?? [];
  const enumNames = readStringArray(schema.enumNames) ?? [];
  return enumValues.map((value, index) => ({ value, label: enumNames[index] ?? value }));
}

function isEmptyValue(value: McpFormValue | undefined): boolean {
  return value === undefined || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readCount(value: unknown): number | undefined {
  if (typeof value === "bigint") return Number(value);
  return readNumber(value);
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}
