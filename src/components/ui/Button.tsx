import { ButtonHTMLAttributes, forwardRef } from "react";
import clsx from "@/lib/clsx";

type Variant = "primary" | "brand" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-brand text-white shadow-brand hover:opacity-95 disabled:opacity-50 disabled:shadow-none",
  brand:
    "bg-brand text-white shadow-brand hover:opacity-95 disabled:opacity-50 disabled:shadow-none",
  secondary:
    "bg-surface text-ink-soft border border-line shadow-sm hover:bg-surface-2 hover:border-line-strong disabled:text-muted-2",
  ghost: "text-ink-soft hover:bg-surface-3 disabled:text-zinc-300",
  danger: "bg-red-600 text-white hover:bg-red-500 disabled:bg-red-300",
};

const sizeClasses: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
>(({ className, variant = "primary", size = "md", ...props }, ref) => (
  <button
    ref={ref}
    className={clsx(
      "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed",
      variantClasses[variant],
      sizeClasses[size],
      className
    )}
    {...props}
  />
));
Button.displayName = "Button";
