import { ButtonHTMLAttributes, forwardRef } from "react";
import clsx from "@/lib/clsx";

type Variant = "primary" | "brand" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const variantClasses: Record<Variant, string> = {
  primary: "bg-zinc-900 text-white hover:bg-zinc-700 disabled:bg-zinc-400",
  brand: "bg-brand text-white hover:bg-brand-hover disabled:bg-brand/40",
  secondary:
    "bg-white text-zinc-700 border border-zinc-300 hover:bg-zinc-50 disabled:text-zinc-400",
  ghost: "text-zinc-600 hover:bg-zinc-100 disabled:text-zinc-300",
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
