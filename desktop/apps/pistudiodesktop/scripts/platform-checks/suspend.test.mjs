import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

import { continuePosix, parseSuspendOutput, stopPosix, windowsSuspend, windowsSuspendScript } from "./suspend.mjs";

describe("windowsSuspendScript", () => {
  it("calls the suspend or the resume function on the image's tree, and reads the image from the environment", () => {
    const suspend = windowsSuspendScript("suspend");
    const resume = windowsSuspendScript("resume");
    expect(suspend).toContain("[PiCheck.Nt]::NtSuspendProcess($process.Handle)");
    expect(suspend).not.toContain("]::NtResumeProcess(");
    expect(resume).toContain("[PiCheck.Nt]::NtResumeProcess($process.Handle)");
    expect(resume).not.toContain("]::NtSuspendProcess(");
    for (const script of [suspend, resume]) {
      expect(script).toContain("$env:PI_IMAGE");
      expect(script).toContain("ParentProcessId");
      // A here-string must open and close on lines of their own, or PowerShell does not parse it.
      expect(script.split("\n")).toContain("'@");
      expect(script.split("\n").some((line) => line.endsWith("@'"))).toBe(true);
    }
  });

  it("refuses another action", () => {
    expect(() => windowsSuspendScript("kill")).toThrow("unknown action");
  });
});

describe("parseSuspendOutput", () => {
  it("reads the count, the pids and the failures", () => {
    expect(parseSuspendOutput("count=3\r\npids=10,11,12\r\n")).toEqual({ count: 3, pids: "10,11,12", failed: null });
    expect(parseSuspendOutput("count=1\npids=7\nfailed=7=0xc0000022")).toEqual({ count: 1, pids: "7", failed: "7=0xc0000022" });
    expect(parseSuspendOutput("")).toEqual({ count: null, pids: "", failed: null });
  });
});

describe("windowsSuspend", () => {
  const exec = (stdout) => async (command, args, options) => {
    exec.seen = { command, args, options };
    return { stdout };
  };

  it("runs powershell with the image in the environment and returns what it counted", async () => {
    const seen = exec("count=2\npids=1,2\n");
    const result = await windowsSuspend("pistudiodesktop.exe", "suspend", { exec: seen });
    expect(result).toEqual({ count: 2, pids: "1,2", failed: null });
    expect(exec.seen.command).toBe("powershell.exe");
    expect(exec.seen.options.env.PI_IMAGE).toBe("pistudiodesktop.exe");
    expect(Buffer.from(exec.seen.args.at(-1), "base64").toString("utf16le")).toContain("NtSuspendProcess($process.Handle)");
  });

  it("fails when no process was found", async () => {
    await expect(windowsSuspend("x.exe", "resume", { exec: exec("count=0\npids=\n") })).rejects.toThrow("no process of x.exe was found to resume");
  });

  it("fails when the system refused one", async () => {
    await expect(windowsSuspend("x.exe", "suspend", { exec: exec("count=2\npids=1,2\nfailed=2=0xc0000022") })).rejects.toThrow("refused 2=0xc0000022");
  });
});

describe.skipIf(process.platform === "win32")("stopPosix and continuePosix", () => {
  it("stops a process and continues it", async () => {
    // A child that prints a line every 50 ms: stopped, it prints none.
    const child = spawn(process.execPath, ["-e", "setInterval(() => console.log('tick'), 50)"], { stdio: ["ignore", "pipe", "ignore"] });
    let lines = 0;
    child.stdout.on("data", (chunk) => {
      lines += String(chunk).split("\n").length - 1;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(lines).toBeGreaterThan(0);
      stopPosix(child.pid);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const frozen = lines;
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(lines).toBe(frozen);
      continuePosix(child.pid);
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(lines).toBeGreaterThan(frozen);
    } finally {
      child.kill("SIGKILL");
    }
  });

  it("does not mind a process that is gone", () => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    return new Promise((resolve) => {
      child.once("exit", () => {
        expect(() => continuePosix(child.pid)).not.toThrow();
        resolve();
      });
    });
  });
});
