import * as React from "react";

import { cn } from "@/lib/utils";

const variants = {
  default: "bg-zinc-100 text-zinc-900 hover:bg-zinc-200",
  destructive: "bg-red-600 text-white hover:bg-red-500",
  outline:
    "border border-zinc-700 bg-transparent text-zinc-100 hover:bg-zinc-800",
  ghost: "bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100",
} as const;

const sizes = {
  default: "h-9 px-4 py-2",
  sm: "h-8 px-3 text-xs",
  icon: "h-9 w-9",
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
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

export { Button };
