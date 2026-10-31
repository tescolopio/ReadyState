import * as React from "react";

import { cn } from "@/lib/utils";

const variants = {
  // One dominant primary action per task area (Modern treatment §4).
  default: "bg-action text-on-action hover:bg-action-hover",
  destructive: "bg-error text-surface hover:opacity-90",
  outline: "border border-line-strong bg-surface text-ink hover:bg-action-soft",
  ghost: "bg-transparent text-ink-2 hover:bg-action-soft hover:text-ink",
} as const;

const sizes = {
  // 44 px targets where practical (AC01).
  default: "min-h-11 px-4 py-2",
  sm: "min-h-9 px-3 text-sm",
  icon: "h-11 w-11",
} as const;

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonProps) {
  return (
    <button
      data-slot="button"
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

export { Button };
