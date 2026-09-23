import type { z } from "zod";
import { requireUser, type RequireUserOptions, type SessionUser } from "@/lib/auth";
import { AppError, fail, type ActionResult } from "@/lib/errors";
import { logger } from "@/lib/logger";

type Context<A> = A extends false ? { user: null } : { user: SessionUser };

type SafeActionConfig<S extends z.ZodType, T, A extends RequireUserOptions | false> = {
  name: string; // used in logs only
  schema: S;
  auth: A; // false only for public actions such as login
  handler: (input: z.output<S>, ctx: Context<A>) => Promise<T>;
};

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

// Wraps a Server Action: validates input with zod, checks the user, and turns every error
// into an ActionResult. Unknown errors are logged (without the input) and hidden from the client.
export function safeAction<S extends z.ZodType, T, A extends RequireUserOptions | false>(
  config: SafeActionConfig<S, T, A>,
) {
  return async (rawInput: unknown): Promise<ActionResult<T>> => {
    const parsed = config.schema.safeParse(rawInput);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path.length ? issue.path.join(".") : undefined;
      return fail("VALIDATION", undefined, field);
    }

    try {
      const user = config.auth === false ? null : await requireUser(config.auth);
      const data = await config.handler(parsed.data, { user } as Context<A>);
      return { ok: true, data };
    } catch (error) {
      if (error instanceof AppError)
        return fail(error.code, error.message, error.field, error.values);
      if (isUniqueViolation(error)) return fail("CONFLICT");
      logger.error("action.failed", error, { action: config.name });
      return fail("INTERNAL");
    }
  };
}
