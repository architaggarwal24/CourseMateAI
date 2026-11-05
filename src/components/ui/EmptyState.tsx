import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Usually a <Button>. */
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("ui-empty", className)}>
      {icon && <div className="ui-empty__icon" aria-hidden="true">{icon}</div>}
      <h3 className="ui-empty__title">{title}</h3>
      {description && <p className="ui-empty__desc">{description}</p>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}
