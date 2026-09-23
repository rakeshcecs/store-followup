// Standard result for every Server Action. `message` is a next-intl key (e.g. "errors.conflict"),
// so the screen shows it in the user's language.

export type ErrorCode =
  "VALIDATION" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "RULE" | "INTERNAL";

// Values for the placeholders in that message — "already used by {name}", "{count} open
// customers". They travel with the key because the key alone cannot carry them, and the
// screen, not the server, decides the language.
export type MessageValues = Record<string, string | number>;

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string; field?: string; values?: MessageValues };

export const defaultMessageKey: Record<ErrorCode, string> = {
  VALIDATION: "errors.validation",
  UNAUTHENTICATED: "errors.unauthenticated",
  FORBIDDEN: "errors.forbidden",
  NOT_FOUND: "errors.notFound",
  CONFLICT: "errors.conflict",
  RULE: "errors.rule",
  INTERNAL: "errors.internal",
};

// Thrown by business rules and permission checks; safeAction() turns it into an ActionResult.
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly field?: string;
  readonly values?: MessageValues;

  constructor(
    code: ErrorCode,
    options: { message?: string; field?: string; values?: MessageValues } = {},
  ) {
    super(options.message ?? defaultMessageKey[code]);
    this.name = "AppError";
    this.code = code;
    this.field = options.field;
    this.values = options.values;
  }
}

export function fail(
  code: ErrorCode,
  message?: string,
  field?: string,
  values?: MessageValues,
): ActionResult<never> {
  return { ok: false, code, message: message ?? defaultMessageKey[code], field, values };
}
