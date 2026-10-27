import * as React from "react";

import { cn } from "@/lib/utils";

const variants = {
  default: "border-transparent bg-zinc-100 text-zinc-900",
  secondary: "border-transparent bg-zinc-800 text-zinc-100",
  destructive: "border-transparent bg-red-600 text-white",
  outline: "border-zinc-700 text-zinc-300",
} as const;

export interface BadgeProps extends React.ComponentProps<"span"> {
  variant?: keyof typeof variants;
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
