import './BackLink.css';

/**
 * Always points at the page's logical parent rather than calling
 * history.back() — someone who landed here from a shared link would
 * otherwise be sent off the site entirely.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="back-link">
      <span aria-hidden="true">←</span> {label}
    </a>
  );
}
