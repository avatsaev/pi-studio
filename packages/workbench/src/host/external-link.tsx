import { type AnchorHTMLAttributes, type MouseEvent } from "react";
import { getHost } from "./install.js";

/**
 * Click activation of an external link: routed to `host.links.openExternal` when the host has one
 * (the default navigation is suppressed), otherwise left to the browser. Middle-click (`auxclick`)
 * and "copy link address" never reach this and keep working natively.
 */
export function routeExternalLinkClick(
  event: Pick<MouseEvent, "preventDefault">,
  url: string,
): void {
  const openExternal = getHost().links.openExternal;
  if (!openExternal) return;
  event.preventDefault();
  openExternal(url);
}

type ExternalAnchorProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href" | "target" | "rel"
> & {
  href: string;
};

/** An `<a target="_blank">` that defers to the host's `links.openExternal` when it has one. */
export function ExternalAnchor({ href, onClick, ...rest }: ExternalAnchorProps) {
  return (
    <a
      {...rest}
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) routeExternalLinkClick(event, href);
      }}
    />
  );
}
