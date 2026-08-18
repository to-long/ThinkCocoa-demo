/**
 * `defaultHook` for OpenAPIHono — turns zod validation failures into the
 * compact `{ error, issues: [{ path, code, params }] }` shape defined in
 * `@kuanadata/shared` (ValidationErrorBody).
 *
 * Each zod schema is declared with an error code from `ValidatorErrorCode`
 * (see `validators/validator-error-code.ts`). That code becomes the
 * `issue.message` on Zod failure; this hook lifts it onto `issues[*].code`.
 * The FE maps the code to a localized message at runtime.
 */

import type { ValidationErrorBody } from '@kuanadata/shared';
import type { Context } from 'hono';

/**
 * Generic validation hook. Typed loosely with `any` so it can slot into every
 * OpenAPIHono `defaultHook` regardless of the app's context generics.
 */
// biome-ignore lint/suspicious/noExplicitAny: intentional — see comment above
export function validationHook(result: any, c: Context): Response | undefined {
  if (result.success) return undefined;
  if (!result.error) return undefined;

  const issues = (
    result.error.issues as Array<{
      path: PropertyKey[];
      message: string;
      code: string;
      minimum?: number;
      maximum?: number;
    }>
  ).map((issue) => {
    const out: ValidationErrorBody['issues'][number] = {
      path: issue.path.map(String).join('.'),
      code: issue.message, // ValidatorErrorCode — see validator-error-code.ts
    };

    // Attach placeholder values the FE might need for message interpolation.
    if (issue.code === 'too_small' && typeof issue.minimum === 'number') {
      out.params = { min: issue.minimum };
    } else if (issue.code === 'too_big' && typeof issue.maximum === 'number') {
      out.params = { max: issue.maximum };
    }

    return out;
  });

  const body: ValidationErrorBody = {
    error: 'validation_failed',
    issues,
  };

  return c.json(body, 400);
}
