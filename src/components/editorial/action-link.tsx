import type { AnchorHTMLAttributes } from "react";

type ActionLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: "primary" | "quiet";
};

export function ActionLink({ className = "", variant = "quiet", ...props }: ActionLinkProps) {
  return <a className={`action-link action-link--${variant} ${className}`.trim()} {...props} />;
}
