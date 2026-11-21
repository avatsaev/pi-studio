/** Shown instead of the workbench when the app host's boot fails. */
export function BootError({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  return (
    <div role="alert" className="boot-error">
      <p>Pi Studio could not start.</p>
      <p className="boot-error-reason">{reason}</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
