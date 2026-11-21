// Counting and ending the app's processes on Windows, with `tasklist` and `taskkill`.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The number of rows `tasklist /FO CSV /NH` printed for `imageName`. "No tasks" is zero. */
export function countTasklistRows(output, imageName) {
  const wanted = imageName.toLowerCase();
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith('"') && line.split('","')[0].replace(/^"/, "").toLowerCase() === wanted).length;
}

export async function countProcesses(imageName) {
  const { stdout } = await execFileAsync("tasklist", ["/FI", `IMAGENAME eq ${imageName}`, "/FO", "CSV", "/NH"]);
  return countTasklistRows(stdout, imageName);
}

/** End every process of `imageName`, with its children. Nothing to end is not an error. */
export async function killProcesses(imageName) {
  await execFileAsync("taskkill", ["/F", "/T", "/IM", imageName]).catch(() => {});
}
