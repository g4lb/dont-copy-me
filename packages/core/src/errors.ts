/**
 * Exit codes are part of the public CLI contract: CI pipelines branch on them.
 */
export const ExitCode = {
  Ok: 0,
  Failure: 1,
  Usage: 2,
  Config: 3,
  VerificationFailed: 4,
  BudgetExceeded: 5,
  Unauthorized: 6,
  NotExecuted: 7,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export class DcmError extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  readonly exitCode: ExitCodeValue;

  constructor(
    code: string,
    message: string,
    options: { hint?: string; exitCode?: ExitCodeValue; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DcmError';
    this.code = code;
    this.hint = options.hint;
    this.exitCode = options.exitCode ?? ExitCode.Failure;
  }
}

export function isDcmError(value: unknown): value is DcmError {
  return value instanceof DcmError;
}

