/**
 * Standard shadcn `Form` primitive for `react-hook-form` + `zod`.
 *
 * Usage pattern:
 * ```tsx
 * const form = useForm<Input>({ resolver: zodResolver(schema) });
 * <Form {...form}>
 *   <form onSubmit={form.handleSubmit(onSubmit)}>
 *     <FormField
 *       control={form.control}
 *       name="email"
 *       render={({ field }) => (
 *         <FormItem>
 *           <FormLabel>Email</FormLabel>
 *           <FormControl><Input {...field} /></FormControl>
 *           <FormMessage />
 *         </FormItem>
 *       )}
 *     />
 *   </form>
 * </Form>
 * ```
 *
 * `FormField` wires Controller + provides field-level context so
 * `FormLabel` / `FormControl` / `FormMessage` can read state without
 * the caller threading `name` / `error` props manually.
 */

import { type Label as LabelPrimitive, Slot } from 'radix-ui';
import * as React from 'react';
import {
  Controller,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
  FormProvider,
  useFormContext,
  useFormState,
} from 'react-hook-form';
import { useIntl } from 'react-intl';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const Form = FormProvider;

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue);

function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ ...props }: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
}

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: fieldContext.name });
  const fieldState = getFieldState(fieldContext.name, formState);

  if (!fieldContext) {
    throw new Error('useFormField should be used within <FormField>');
  }

  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
};

type FormItemContextValue = {
  id: string;
};

const FormItemContext = React.createContext<FormItemContextValue>({} as FormItemContextValue);

function FormItem({ className, ...props }: React.ComponentProps<'div'>) {
  const id = React.useId();

  return (
    <FormItemContext.Provider value={{ id }}>
      <div data-slot="form-item" className={cn('grid gap-2', className)} {...props} />
    </FormItemContext.Provider>
  );
}

function FormLabel({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  const { error, formItemId } = useFormField();

  return (
    <Label
      data-slot="form-label"
      data-error={!!error}
      className={cn('data-[error=true]:text-destructive', className)}
      htmlFor={formItemId}
      {...props}
    />
  );
}

function FormControl({ ...props }: React.ComponentProps<typeof Slot.Root>) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();

  return (
    <Slot.Root
      data-slot="form-control"
      id={formItemId}
      aria-describedby={!error ? `${formDescriptionId}` : `${formDescriptionId} ${formMessageId}`}
      aria-invalid={!!error}
      {...props}
    />
  );
}

function FormDescription({ className, ...props }: React.ComponentProps<'p'>) {
  const { formDescriptionId } = useFormField();

  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

// Translate the error message text through react-intl with two
// patterns:
//   1. SCREAMING_SNAKE_CASE codes from `@kuanadata/shared` zod
//      validators (e.g. `ROLE_CODE_PATTERN`) → look up
//      `validator.<CODE>`.
//   2. Dotted intl keys (e.g. `users.userDialog.scope.required`)
//      passed as the schema message → look up that id directly.
//   Anything else (already-localised strings, defaults) is shown
// as-is.
const VALIDATOR_CODE_RE = /^[A-Z][A-Z0-9_]*$/;
const INTL_KEY_RE = /^[a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+$/;

function FormMessage({ className, ...props }: React.ComponentProps<'p'>) {
  const { error, formMessageId } = useFormField();
  const intl = useIntl();
  const raw = error ? String(error?.message ?? '') : '';
  let body: React.ReactNode = '';
  if (raw) {
    if (VALIDATOR_CODE_RE.test(raw)) {
      body = intl.formatMessage({ id: `validator.${raw}`, defaultMessage: raw });
    } else if (INTL_KEY_RE.test(raw)) {
      body = intl.formatMessage({ id: raw, defaultMessage: raw });
    } else {
      body = raw;
    }
  } else {
    body = props.children;
  }

  if (!body) return null;

  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      className={cn('text-destructive text-xs', className)}
      {...props}
    >
      {body}
    </p>
  );
}

export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
};
