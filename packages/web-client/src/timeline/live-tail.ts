/** Number of trailing output lines a running tool card shows. */
export const LIVE_TAIL_LINES = 12;

/** Last `maxLines` lines of `output`, newest last; a trailing newline adds no blank line. */
export function liveTail(output: string, maxLines: number = LIVE_TAIL_LINES): string {
  const lines = output.replace(/\r?\n$/, "").split(/\r?\n/);
  return lines.length <= maxLines ? lines.join("\n") : lines.slice(-maxLines).join("\n");
}
