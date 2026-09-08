import { InputHTMLAttributes, TextareaHTMLAttributes, forwardRef } from "react";
import clsx from "@/lib/clsx";

const fieldClasses =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-gold";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={clsx(fieldClasses, className)} {...props} />
  )
);
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={clsx(fieldClasses, className)} {...props} />
));
Textarea.displayName = "Textarea";
