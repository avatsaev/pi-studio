// Stopping and continuing the app's processes, as a machine's sleep does to them: the app's tick
// finds time unaccounted for and counts a wake (`resumeSignals.wake`). macOS stops the app's own
// process with SIGSTOP and SIGCONT. Windows has no signal for it: a PowerShell script calls
// `NtSuspendProcess` and `NtResumeProcess` (ntdll; what Process Explorer's "Suspend" does) on the
// app's process and every descendant, the webview's processes among them.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Stop `pid` (SIGSTOP). */
export function stopPosix(pid) {
  process.kill(pid, "SIGSTOP");
}

/** Continue `pid` (SIGCONT). A process that is gone is not an error. */
export function continuePosix(pid) {
  try {
    process.kill(pid, "SIGCONT");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

/**
 * The PowerShell source that suspends (`action` "suspend") or resumes ("resume") every process
 * named `$env:PI_IMAGE` and all their descendants, and prints `count=<n>` and `pids=<list>`. The
 * image name travels in the environment, so nothing is quoted into the script.
 */
export function windowsSuspendScript(action) {
  if (action !== "suspend" && action !== "resume") throw new Error(`unknown action ${action}`);
  const call = action === "suspend" ? "NtSuspendProcess" : "NtResumeProcess";
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -Namespace PiCheck -Name Nt -MemberDefinition @'",
    "[DllImport(\"ntdll.dll\")] public static extern int NtSuspendProcess(IntPtr handle);",
    "[DllImport(\"ntdll.dll\")] public static extern int NtResumeProcess(IntPtr handle);",
    "'@",
    "$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name)",
    "$found = New-Object System.Collections.Generic.List[int]",
    "$queue = New-Object System.Collections.Generic.Queue[int]",
    "foreach ($p in $all) { if ($p.Name -ieq $env:PI_IMAGE) { $queue.Enqueue([int]$p.ProcessId) } }",
    "while ($queue.Count -gt 0) {",
    "  $id = $queue.Dequeue()",
    "  if ($found.Contains($id)) { continue }",
    "  $found.Add($id)",
    "  foreach ($child in $all) { if ([int]$child.ParentProcessId -eq $id) { $queue.Enqueue([int]$child.ProcessId) } }",
    "}",
    "$failed = @()",
    "foreach ($id in $found) {",
    "  try {",
    "    $process = [System.Diagnostics.Process]::GetProcessById($id)",
    `    $status = [PiCheck.Nt]::${call}($process.Handle)`,
    "    if ($status -ne 0) { $failed += \"$id=0x$($status.ToString('x8'))\" }",
    "  } catch { $failed += \"$id=$($_.Exception.Message)\" }",
    "}",
    "Write-Output \"count=$($found.Count)\"",
    "Write-Output \"pids=$($found -join ',')\"",
    "if ($failed.Count -gt 0) { Write-Output \"failed=$($failed -join ';')\" }",
  ].join("\n");
}

/** What the script printed: `{ count, pids, failed }`. */
export function parseSuspendOutput(output) {
  const field = (name) => new RegExp(`^${name}=(.*)$`, "m").exec(output)?.[1]?.trim() ?? null;
  const count = field("count");
  return { count: count === null ? null : Number(count), pids: field("pids") ?? "", failed: field("failed") };
}

/**
 * Suspend or resume the processes of `imageName` (Windows). Throws when none was found or when the
 * system refused any; the error names the processes and their status.
 */
export async function windowsSuspend(imageName, action, { exec = execFileAsync } = {}) {
  // -EncodedCommand (base64 of the UTF-16LE source) so that no quote or line break of the script
  // depends on how the command line is split.
  const encoded = Buffer.from(windowsSuspendScript(action), "utf16le").toString("base64");
  const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
    env: { ...process.env, PI_IMAGE: imageName },
    timeout: 60_000,
  });
  const result = parseSuspendOutput(stdout);
  if (!result.count) throw new Error(`no process of ${imageName} was found to ${action} (output: ${stdout.trim().slice(0, 300)})`);
  if (result.failed) throw new Error(`${action} of ${imageName}: the system refused ${result.failed} (processes ${result.pids})`);
  return result;
}
