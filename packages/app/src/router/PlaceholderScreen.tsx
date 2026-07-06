/**
 * PlaceholderScreen — rendered for routes not yet implemented.
 * Shows the route name for dev/debugging; replaced by real screens in sprint-019+.
 */

import { useParams, useSearchParams } from "react-router";

export function PlaceholderScreen({ name }: { name: string }) {
  const params = useParams();
  const [searchParams] = useSearchParams();

  return (
    <div className="pi-placeholder-screen" style={{ padding: 24 }}>
      <h2 style={{ margin: 0 }}>{name}</h2>
      {Object.keys(params).length > 0 && (
        <pre style={{ fontSize: 12, opacity: 0.7 }}>
          params: {JSON.stringify(params, null, 2)}
        </pre>
      )}
      {searchParams.toString() && (
        <pre style={{ fontSize: 12, opacity: 0.7 }}>
          search: {searchParams.toString()}
        </pre>
      )}
    </div>
  );
}
