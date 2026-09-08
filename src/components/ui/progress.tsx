import { cn } from "@/lib/utils";

export function Progress({
  indeterminate = false,
  className,
}: {
  indeterminate?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full h-1.5 rounded-full bg-foreground/10 overflow-hidden",
        className
      )}
    >
      <div
        className={cn(
          "h-full rounded-full bg-accent",
          indeterminate ? "w-1/3 animate-pulse" : "w-full"
        )}
      />
    </div>
  );
}
