---
name: fe-form
description: KuanaData FE convention for any create/update/edit form in a dialog or page. Use when adding a new form, refactoring an existing form, or reviewing form code. MANDATORY: react-hook-form + zod — no `useState` for form fields, no manual validation. Schemas reused from `@kuanadata/shared/validators` whenever possible.
---

# FE form — react-hook-form + zod, never `useState`

Every create / update / edit form in this repo MUST use `react-hook-form` + `zod` via the shadcn `Form` primitive. **No exceptions** — if a form is using `useState` for its fields, it's a bug, not a stylistic choice.

Reference: `apps/fe/src/features/farmers/components/farmer-dialog.tsx` (most fields, mix of Input / Select / Checkbox / number / date — covers every binding pattern).

## Stack (already installed)

- `react-hook-form` ^7.72
- `zod` ^4.3
- `@hookform/resolvers` ^5.2
- shadcn `Form` primitive at `apps/fe/src/components/ui/form.tsx`
  — exports `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage`, `FormDescription`

## Mandatory rules

1. **No `useState` for form fields.** The only state allowed is for non-form things (e.g. `showPassword` toggle, `isLoading` if not using `form.formState.isSubmitting`, `pageError` for API-level submit failures).
2. **No manual validation.** Drop every `if (!field.trim()) errors.field = ...`. Use `zodResolver` and let zod do the work.
3. **Reuse shared schemas.** Most forms map to a BE schema in `@kuanadata/shared/validators/*.ts`. Use them directly — don't duplicate. If the form needs to deviate (extra fields, omit fields), use zod's `.omit()` / `.extend()` / `.pick()`.
4. **`mode: "onSubmit"`** (the RHF default — don't override). Validating on blur fires the regex error the moment the admin tabs out of an empty field, before they've typed anything. After the first submit, RHF's default `reValidateMode: "onChange"` keeps messages fresh as the user fixes.
5. **`Form` wraps `<form>`.** Plumb `form.handleSubmit(onSubmit)` through `<form onSubmit={...}>`.

## Canonical pattern

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { createFooSchema } from "@kuanadata/shared";

type Input = z.infer<typeof createFooSchema>;

export function FooDialog({ open, onOpenChange, onSubmit, initialData }: Props) {
  const form = useForm<Input>({
    resolver: zodResolver(createFooSchema),
    defaultValues: { name: "", description: "" },
    // mode default = "onSubmit" — do not override.
  });

  // Reset on open / close to keep the form aligned with `initialData`.
  // `form` itself is a stable ref so it's safe to omit from the deps.
  useEffect(() => {
    if (!open) form.reset(emptyDefaults);
    else if (initialData) form.reset(initialData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialData]);

  const handleValid = async (data: Input) => {
    try {
      await onSubmit(data);
    } catch (err) {
      // Surface API failures as a banner / toast (NOT a form error).
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleValid)}>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl><Input {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        ...
      </form>
    </Form>
  );
}
```

## Bridging non-Input components

Most fields are NOT `<Input>`. Use `FormField`'s render prop to wire `field.value` / `field.onChange` into anything:

### Select (Radix)
```tsx
<FormField
  control={form.control}
  name="cooperativeId"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Cooperative</FormLabel>
      <FormControl>
        <Select value={field.value} onValueChange={field.onChange}>
          <SelectTrigger>...</SelectTrigger>
          <SelectContent>...</SelectContent>
        </Select>
      </FormControl>
      <FormMessage />
    </FormItem>
  )}
/>
```

### Checkbox / Switch
```tsx
<FormControl>
  <Checkbox
    checked={field.value}
    onCheckedChange={field.onChange}
  />
</FormControl>
```

### Picker that owns its own internal state (Set, Map, ...)
Wrap with `Controller` (or use the render prop) and marshal at the boundary:
```tsx
<Controller
  control={form.control}
  name="permissionCodes"
  render={({ field }) => (
    <PermissionsPicker
      selected={new Set(field.value)}
      onChange={(set) => field.onChange([...set])}
    />
  )}
/>
```

### Number / date inputs
Coerce empty string to `null` (or `undefined`) before handing to RHF — otherwise `NaN` slips into integer fields:
```tsx
<Input
  type="number"
  value={field.value ?? ""}
  onChange={(e) => {
    const v = e.target.value;
    field.onChange(v === "" ? null : Number(v));
  }}
/>
```

## Schema strategy — when to deviate from shared

Common patterns when the form shape doesn't match the wire shape exactly:

| Need | Tool |
|---|---|
| Form has extra field (`firstName` + `lastName`, but BE wants `name`) | Local zod schema; map at submit (`name = firstName + lastName`) |
| Field is auto-derived (e.g. `code` from `name`) | `.omit({ code: true })` on the shared schema |
| Field optional in form, required in BE | `.partial()` or `.optional()` per field |
| Two modes (create vs update) need different shapes | Two schemas, pick by `isEdit`: `resolver: zodResolver(isEdit ? updateSchema : createSchema)` |

**Document the deviation** with a comment so the next reader knows why the form shape isn't 1:1 with the BE.

## Common mistakes (don't do these)

1. ❌ `useState` for form fields. → Use `useForm`.
2. ❌ Manual validation `if (!name) errors.name = "Required"`. → Use zod.
3. ❌ `mode: "onBlur"` or `"onChange"`. → Use RHF default (`"onSubmit"`).
4. ❌ Calling `form.handleSubmit(...)` outside the `<form onSubmit>` wiring (e.g. from a button click handler). → Always go through the form's submit event.
5. ❌ Local schema duplicating a shared one. → Reuse + `.omit()` / `.extend()`.
6. ❌ Showing API errors as form-field errors. → Banner / toast, not `FormMessage`. (Server-side validation errors that map cleanly to a single field can use `form.setError("field", ...)`, but generic 5xx / 409 / 400 don't.)

## Two-schema pattern (create vs update)

For dialogs that handle both create AND update modes, the create schema usually has required fields that update doesn't (password, email when better-auth owns it, etc). Pattern:

```tsx
const createSchema = z.object({ ... required ... });
const updateSchema = z.object({ ... required subset ... });

type FormValues = z.infer<typeof createSchema>; // superset

const form = useForm<FormValues>({
  resolver: zodResolver(isEdit ? updateSchema : createSchema) as never,
  // ^ cast required for RHF + zod 4 generic narrowing — comment why.
});
```

## What to delegate vs do yourself

Form refactor is a mostly-mechanical task. If you're refactoring more than two existing dialogs at once, use parallel agents (one per dialog). Brief each agent with:
1. The file path
2. The shared schema to reuse
3. The list of `useState` calls to drop
4. The page-level callsite signature (so the parent contract stays stable)

After agents land, run `bunx tsc --noEmit` (NOT just `bun run build` — rsbuild only does esbuild type-stripping).

## Verification before committing

```bash
cd apps/fe
bunx tsc --noEmit   # full type check; bun run build alone is NOT enough
bun run build       # rsbuild bundle
```

Both must pass.

## Reference files (read before writing new forms)

- Form primitive: `apps/fe/src/components/ui/form.tsx`
- Most-complete form: `apps/fe/src/features/farmers/components/farmer-dialog.tsx`
- Two-schema (create/update) pattern: `apps/fe/src/features/admin/components/users/user-dialog.tsx`
- Shared schemas: `packages/shared/src/validators/*.ts`
