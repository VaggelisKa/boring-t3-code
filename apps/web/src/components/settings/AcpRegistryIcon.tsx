import { cn } from "../../lib/utils";
import { ACPRegistryIcon } from "../Icons";

// Remote agent icons are never loaded, so every ACP agent shows the local mark.
export function AcpRegistryAgentIcon({
  className,
  fallbackClassName,
}: {
  readonly className?: string;
  readonly fallbackClassName?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground",
        className,
      )}
    >
      <ACPRegistryIcon className={cn("size-4", fallbackClassName)} data-slot="acp-icon-fallback" />
    </span>
  );
}
