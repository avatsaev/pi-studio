import { describe, expect, it } from "vitest";

import { Report, renderSummary } from "./report.mjs";
import {
  acceptableAfterStates,
  appArguments,
  appEnvironment,
  describeUpdate,
  fileChanged,
  headingFor,
  installLayout,
  installSteps,
  installerKind,
  judgeStage,
  parseOptions,
  polkitRule,
  stageFacts,
  stagesOf,
} from "./update-check.mjs";

const LATEST = "https://example.test/desktop-v0.3.1/latest.json";
const SELF = "https://example.test/desktop-v0.3.1/self-check.json";

describe("installerKind", () => {
  it("reads the kind from the installer's name", () => {
    expect(installerKind("/x/Pi.Studio_0.3.0_amd64.AppImage")).toBe("appimage");
    expect(installerKind("Pi.Studio_0.3.0_amd64.deb")).toBe("deb");
    expect(installerKind("Pi.Studio_0.3.0_universal.dmg")).toBe("app");
    expect(installerKind("C:\\x\\Pi.Studio_0.3.0_x64-setup.exe")).toBe("nsis");
  });

  it("refuses what it cannot tell", () => {
    expect(() => installerKind("Pi.Studio_0.3.0_x64_en-US.msi")).toThrow("cannot tell");
    expect(() => installerKind("Pi.Studio-0.3.0-1.x86_64.rpm")).toThrow("cannot tell");
  });
});

describe("parseOptions", () => {
  it("parses the P -> N run", () => {
    const options = parseOptions(["--from", "a.AppImage", "--manifest", LATEST, "--expect-version", "0.3.1", "--self-check-manifest", SELF], "linux");
    expect(options).toMatchObject({
      from: "a.AppImage",
      kind: "appimage",
      selfCheckOnly: false,
      manifest: LATEST,
      expectVersion: "0.3.1",
      selfCheckManifest: SELF,
      installTimeoutMs: 300_000,
      out: "update-check-out",
    });
  });

  it("parses the N -> N run, with or without the version", () => {
    expect(parseOptions(["--self-check", "--from", "a.deb", "--manifest", SELF], "linux")).toMatchObject({ selfCheckOnly: true, kind: "deb", expectVersion: undefined });
    expect(parseOptions(["--self-check", "--from", "a.dmg", "--manifest", SELF, "--expect-version", "0.3.1"], "darwin")).toMatchObject({ kind: "app", expectVersion: "0.3.1" });
  });

  it("takes --kind over the name and a limit in seconds", () => {
    const options = parseOptions(["--from", "download", "--kind", "deb", "--manifest", LATEST, "--expect-version", "0.3.1", "--install-timeout", "60"], "linux");
    expect(options).toMatchObject({ kind: "deb", installTimeoutMs: 60_000 });
  });

  it("needs --from, --manifest, and --expect-version unless it is a self check", () => {
    expect(() => parseOptions([], "linux")).toThrow("--from is required");
    expect(() => parseOptions(["--from", "a.deb"], "linux")).toThrow("--manifest is required");
    expect(() => parseOptions(["--from", "a.deb", "--manifest", LATEST], "linux")).toThrow("--expect-version is required");
  });

  it("refuses a bad version, address, limit, extra argument and a mix of the two modes", () => {
    const base = ["--from", "a.deb", "--manifest", LATEST, "--expect-version", "0.3.1"];
    expect(() => parseOptions(["--from", "a.deb", "--manifest", LATEST, "--expect-version", "0.3"], "linux")).toThrow("major.minor.patch");
    expect(() => parseOptions(["--from", "a.deb", "--manifest", "ftp://x/y.json", "--expect-version", "0.3.1"], "linux")).toThrow("http or https");
    expect(() => parseOptions(["--from", "a.deb", "--manifest", "nonsense", "--expect-version", "0.3.1"], "linux")).toThrow("not an address");
    expect(() => parseOptions([...base, "--install-timeout", "3"], "linux")).toThrow("--install-timeout");
    expect(() => parseOptions([...base, "extra"], "linux")).toThrow('unexpected argument "extra"');
    expect(() => parseOptions(["--self-check", ...base, "--self-check-manifest", SELF], "linux")).toThrow("--self-check-manifest belongs");
  });

  it("allows only the kinds of the system it runs on", () => {
    expect(() => parseOptions(["--from", "a.dmg", "--manifest", LATEST, "--expect-version", "0.3.1"], "linux")).toThrow("cannot run on linux");
    expect(() => parseOptions(["--from", "a.deb", "--manifest", LATEST, "--expect-version", "0.3.1"], "darwin")).toThrow("cannot run on darwin");
    expect(() => parseOptions(["--from", "a-setup.exe", "--manifest", LATEST, "--expect-version", "0.3.1"], "win32")).not.toThrow();
    expect(() => parseOptions(["--from", "a.deb", "--manifest", LATEST, "--expect-version", "0.3.1"], "freebsd")).toThrow("no check for freebsd");
  });
});

describe("stagesOf", () => {
  it("makes the update stage first, then the self check on the same install", () => {
    const options = parseOptions(["--from", "a.deb", "--manifest", LATEST, "--expect-version", "0.3.1", "--self-check-manifest", SELF], "linux");
    expect(stagesOf(options)).toEqual([
      { id: "update", manifest: LATEST, selfCheck: false, version: "0.3.1" },
      { id: "self-check", manifest: SELF, selfCheck: true, version: "0.3.1" },
    ]);
  });

  it("makes only the self check for --self-check", () => {
    const options = parseOptions(["--self-check", "--from", "a.deb", "--manifest", SELF], "linux");
    expect(stagesOf(options)).toEqual([{ id: "self-check", manifest: SELF, selfCheck: true, version: undefined }]);
  });
});

const file = (over = {}) => ({ ino: 10, size: 100, mtimeMs: 1000, ctimeMs: 2000, ...over });
const evidence = (over = {}) => ({
  before: { version: "0.3.0", kind: "appimage", manifest: "override", state: "idle", file: file() },
  offered: "0.3.1",
  after: { version: "0.3.1", kind: "appimage", manifest: "override", state: "up_to_date", lastError: undefined, file: file({ ino: 11, mtimeMs: 3000, ctimeMs: 3000 }) },
  oldExited: true,
  newPids: [4321],
  ...over,
});
const update = { id: "update", selfCheck: false, version: "0.3.1" };
const selfCheck = { id: "self-check", selfCheck: true, version: undefined };

describe("fileChanged", () => {
  it("sees another file, or the same file written again", () => {
    expect(fileChanged(file(), file())).toBe(false);
    expect(fileChanged(file(), file({ ino: 11 }))).toBe(true);
    expect(fileChanged(file(), file({ mtimeMs: 1001 }))).toBe(true);
    expect(fileChanged(file(), file({ ctimeMs: 2001 }))).toBe(true);
  });
});

describe("judgeStage", () => {
  it("passes an update to the expected version", () => {
    expect(judgeStage(update, evidence())).toEqual([]);
  });

  it("passes a self check: same version, offered a higher one, a new process, the file replaced, offered again", () => {
    const same = evidence({
      offered: "0.3.2-selfcheck",
      before: { ...evidence().before, version: "0.3.1" },
      after: { ...evidence().after, version: "0.3.1", state: "available" },
    });
    expect(judgeStage(selfCheck, same)).toEqual([]);
    expect(judgeStage({ ...selfCheck, version: "0.3.1" }, same)).toEqual([]);
  });

  it("fails each thing that went wrong, by name", () => {
    const wrongVersion = evidence({ after: { ...evidence().after, version: "0.3.0" } });
    expect(judgeStage(update, wrongVersion).join("\n")).toContain("runs version 0.3.0 after the restart, expected 0.3.1");
    expect(judgeStage(update, wrongVersion).join("\n")).toContain("the version did not change");
    expect(judgeStage(update, evidence({ offered: "0.3.5" })).join("\n")).toContain("offered version 0.3.5, expected 0.3.1");
    expect(judgeStage(update, evidence({ oldExited: false })).join("\n")).toContain("did not exit");
    expect(judgeStage(update, evidence({ newPids: [] })).join("\n")).toContain("no new process");
    expect(judgeStage(update, evidence({ after: { ...evidence().after, file: file() } })).join("\n")).toContain("installed file was not replaced");
    expect(judgeStage(update, evidence({ after: { ...evidence().after, lastError: "offline" } })).join("\n")).toContain('last error "offline"');
    expect(judgeStage(update, evidence({ after: { ...evidence().after, state: "failed" } })).join("\n")).toContain('in state "failed"');
    expect(judgeStage(update, evidence({ before: { ...evidence().before, manifest: "default" } })).join("\n")).toContain("did not take --update-manifest");
    expect(judgeStage(update, evidence({ after: { ...evidence().after, kind: "deb" } })).join("\n")).toContain("kind changed");
  });

  it("does not need the process list, and fails a self check that moved the version or was offered nothing higher", () => {
    expect(judgeStage(update, evidence({ newPids: null }))).toEqual([]);
    const moved = evidence({ offered: "0.3.2-selfcheck", after: { ...evidence().after, version: "0.3.2" } });
    expect(judgeStage(selfCheck, moved).join("\n")).toContain("changed the version");
    expect(judgeStage(selfCheck, evidence({ offered: "0.3.0" })).join("\n")).toContain("not a version above");
  });

  it("accepts `available` after a self check only", () => {
    expect(acceptableAfterStates(selfCheck)).toContain("available");
    expect(acceptableAfterStates(update)).not.toContain("available");
    expect(acceptableAfterStates(update)).not.toContain("restart_needed");
  });
});

describe("describeUpdate", () => {
  it("names the state and what explains it", () => {
    expect(describeUpdate({ state: "failed", code: "signature", version: "0.3.1" })).toBe("failed (version=0.3.1, code=signature)");
    expect(describeUpdate({ state: "downloading", received: 5, total: 10 })).toBe("downloading (received=5, total=10)");
    expect(describeUpdate({ state: "idle" })).toBe("idle");
    expect(describeUpdate(undefined)).toBe("no update part");
  });
});

describe("polkitRule", () => {
  it("lets the one user run pkexec and nothing else", () => {
    const rule = polkitRule("runner");
    expect(rule).toContain('action.id == "org.freedesktop.policykit.exec"');
    expect(rule).toContain('subject.user == "runner"');
    expect(rule).toContain("polkit.Result.YES");
  });

  it("refuses a user name that could break the rule", () => {
    expect(() => polkitRule('x" || true || "')).toThrow("cannot write a polkit rule");
    expect(() => polkitRule("")).toThrow("cannot write a polkit rule");
  });
});

describe("installLayout and installSteps", () => {
  const dirs = { workDir: "/tmp/w", localAppData: "C:\\Users\\runner\\AppData\\Local" };

  it("places each kind", () => {
    expect(installLayout("appimage", dirs)).toEqual({ exe: "/tmp/w/install/PiStudio.AppImage", launch: "/tmp/w/install/PiStudio.AppImage" });
    expect(installLayout("deb", dirs).exe).toBe("/usr/bin/pistudiodesktop");
    expect(installLayout("app", dirs)).toEqual({
      exe: "/Applications/Pi Studio.app/Contents/MacOS/pistudiodesktop",
      launch: "/Applications/Pi Studio.app/Contents/MacOS/pistudiodesktop",
      bundle: "/Applications/Pi Studio.app",
    });
    expect(installLayout("nsis", dirs).exe).toBe("C:\\Users\\runner\\AppData\\Local\\Pi Studio\\pistudiodesktop.exe");
    expect(() => installLayout("rpm", dirs)).toThrow("unknown install kind");
  });

  it("copies an AppImage and makes it executable", () => {
    const layout = installLayout("appimage", dirs);
    expect(installSteps("appimage", "/in/a.AppImage", layout, "/mnt")).toEqual([{ op: "copy", from: "/in/a.AppImage", to: layout.launch, mode: 0o755 }]);
  });

  it("installs a .deb through sudo and apt-get, without a prompt", () => {
    const [step] = installSteps("deb", "/in/a.deb", installLayout("deb", dirs), "/mnt");
    expect(step).toMatchObject({ op: "run", command: "sudo", args: ["-n", "env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "install", "-y", "/in/a.deb"] });
  });

  it("mounts the disk image, copies the app, always detaches, and may fail to clear the quarantine mark", () => {
    const steps = installSteps("app", "/in/a.dmg", installLayout("app", dirs), "/tmp/w/mnt");
    expect(steps.map((s) => [s.command, s.args[0]])).toEqual([
      ["hdiutil", "attach"],
      ["ditto", "/tmp/w/mnt/Pi Studio.app"],
      ["hdiutil", "detach"],
      ["xattr", "-dr"],
    ]);
    expect(steps[0].args).toContain("-nobrowse");
    expect(steps[1].args[1]).toBe("/Applications/Pi Studio.app");
    expect(steps.map((s) => [s.always === true, s.tolerate === true])).toEqual([
      [false, false],
      [false, false],
      [true, false],
      [false, true],
    ]);
  });

  it("runs the NSIS installer silently", () => {
    expect(installSteps("nsis", "C:\\in\\a-setup.exe", installLayout("nsis", dirs), "")).toEqual([
      { op: "run", command: "C:\\in\\a-setup.exe", args: ["/S"], timeoutMs: 300_000 },
    ]);
  });

  it("gives every run step a time limit", () => {
    for (const kind of ["deb", "app", "nsis"]) {
      for (const step of installSteps(kind, "/in/x", installLayout(kind, dirs), "/mnt")) expect(step.timeoutMs).toBeGreaterThan(0);
    }
  });
});

describe("appArguments and appEnvironment", () => {
  it("launches with the control socket, the scratch directory, the file secret store and the manifest", () => {
    expect(appArguments({ port: 7001, tokenFile: "/t/token", configDir: "/t/config", manifest: LATEST })).toEqual([
      "--control",
      "7001",
      "--control-token-file",
      "/t/token",
      "--secret-store=file",
      "--config-dir",
      "/t/config",
      "--update-manifest",
      LATEST,
    ]);
  });

  it("leaves the job's secrets out of the app's environment", () => {
    const env = appEnvironment({ PATH: "/bin", DISPLAY: ":99", TAURI_SIGNING_PRIVATE_KEY: "k", GITHUB_TOKEN: "t", MY_PASSWORD: "p", UNSET: undefined });
    expect(env).toEqual({ PATH: "/bin", DISPLAY: ":99" });
  });
});

describe("the report", () => {
  it("names the system, the kind and the mode in the heading", () => {
    expect(headingFor("linux", "deb", false)).toBe("Desktop update check: Linux, deb");
    expect(headingFor("darwin", "app", true)).toBe("Desktop update check: macOS, app (self check)");
    expect(headingFor("win32", "nsis", false)).toBe("Desktop update check: Windows, nsis");
  });

  it("prints a stage's evidence, the processes and the file before and after", () => {
    const e = evidence();
    const lines = stageFacts({ manifest: LATEST }, { ...e, oldPids: [1, 2], newPids: [3], downloaded: "2 progress reads" });
    expect(lines).toContain(`manifest ${LATEST}`);
    expect(lines).toContain("version 0.3.0 -> 0.3.1 (offered 0.3.1)");
    expect(lines).toContain("processes before 1 2; new 3");
    expect(lines.some((l) => l.startsWith("installed file before: 100 bytes"))).toBe(true);
    expect(stageFacts({ manifest: LATEST }, { ...e, oldPids: [], newPids: null, downloaded: "x" })).toContain("processes before none found; new not listed");
  });

  it("renders a failed step in the job summary with its reason and the skipped ones", async () => {
    const report = new Report();
    await report.run("install", "install a.deb (deb)", async () => {});
    await report.run("update.install", "update.install downloads and installs it", async () => {
      throw new Error("the install ended in failed (code=refused)");
    });
    report.skipAll([{ id: "update.restart", title: "restart" }], "update.install failed");
    const summary = renderSummary(headingFor("linux", "deb", false), report);
    expect(summary).toContain("## Desktop update check: Linux, deb");
    expect(summary).toContain("1 passed, 1 failed, 1 skipped.");
    expect(summary).toContain("| FAIL | `update.install`");
    expect(summary).toContain("code=refused");
    expect(summary).toContain("| SKIP | `update.restart`");
  });
});
