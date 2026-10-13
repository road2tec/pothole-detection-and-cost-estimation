import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/format';

const control =
  'w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-faint shadow-[inset_0_1px_0_rgb(0_0_0/0.02)] transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/15';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(control, 'h-9', className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(control, 'min-h-[80px] py-2', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select ref={ref} className={cn(control, 'h-9 appearance-none pr-8', className)} {...props}>
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
  </div>
));
Select.displayName = 'Select';

export function Label({ className, ...props }: LabelPrimitive.LabelProps) {
  return <LabelPrimitive.Root className={cn('text-[13px] font-medium text-ink-2', className)} {...props} />;
}

interface FieldProps {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode;
}

/** Labelled form field that wires id, aria-invalid and aria-describedby for accessibility. */
export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </Label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Switch({ className, ...props }: SwitchPrimitive.SwitchProps) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-line-strong transition-colors data-[state=checked]:bg-accent disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}
