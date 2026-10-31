import * as React from "react";

import { cn } from "@/lib/utils";

const variants = {
  default: "border-transparent bg-action text-on-action",
  secondary: "border-transparent bg-action-soft text-ink",
  destructive: "border-transparent bg-error-soft text-error",
  outline: "border-line-strong text-ink-2",
} as const;

export interface BadgeProps extends React.ComponentProps<"span"> {
  variant?: keyof typeof variants;
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
