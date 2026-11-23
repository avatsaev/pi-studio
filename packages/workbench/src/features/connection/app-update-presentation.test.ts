import { describe, expect, it } from "vitest";
import type { AppUpdateFailureCode, AppUpdateUnavailableReason } from "../../host/types.js";
import { appUpdateView } from "./app-update-presentation.js";

const RELEASE = "https://github.com/avatsaev/pi-studio/releases/tag/desktop-v0.3.1";

function downloadText(received: number, total?: number): string | undefined {
  return appUpdateView({ state: "downloading", version: "0.3.1", received, total })?.text;
}

describe("appUpdateView", () => {
  it("shows nothing while idle, checking or up to date", () => {
    expect(appUpdateView({ state: "idle" })).toBeNull();
    expect(appUpdateView({ state: "checking" })).toBeNull();
    expect(appUpdateView({ state: "up_to_date", checkedAt: 1 })).toBeNull();
  });

  it("offers an available build and installs on click", () => {
    const view = appUpdateView({ state: "available", version: "0.3.1", releaseUrl: RELEASE });

    expect(view).toMatchObject({
      text: "Update 0.3.1",
      tone: "attention",
      action: { kind: "install" },
    });
  });

  it("shows the download's whole percent without an action", () => {
    const view = appUpdateView({
      state: "downloading",
      version: "0.3.1",
      received: 425,
      total: 1000,
    });

    expect(view).toMatchObject({ text: "Updating 42%", tone: "muted", action: null });
  });

  it("clamps the percent to 0..100 and drops it when the total is unknown", () => {
    expect(downloadText(5, 0)).toBe("Updating…");
    expect(downloadText(5)).toBe("Updating…");
    expect(downloadText(2000, 1000)).toBe("Updating 100%");
    expect(downloadText(-1, 1000)).toBe("Updating 0%");
    expect(downloadText(0, 1000)).toBe("Updating 0%");
  });

  it("asks for a restart once installed", () => {
    const view = appUpdateView({ state: "restart_needed", version: "0.3.1" });

    expect(view).toMatchObject({
      text: "Restart to update",
      tone: "attention",
      action: { kind: "restart" },
    });
  });

  it("links to the release page when the install cannot update in place", () => {
    const view = appUpdateView({
      state: "cannot_install",
      version: "0.3.1",
      releaseUrl: RELEASE,
      reason: "no_pkexec",
    });

    expect(view).toMatchObject({
      text: "0.3.1 available",
      tone: "muted",
      action: { kind: "open", url: RELEASE },
    });
    expect(view?.tooltip).toContain("pkexec");
  });

  it("explains every reason in the tooltip", () => {
    const reasons: AppUpdateUnavailableReason[] = [
      "development_build",
      "not_writable",
      "read_only_location",
      "no_pkexec",
    ];
    const tooltips = reasons.map(
      (reason) =>
        appUpdateView({ state: "cannot_install", version: "1", releaseUrl: RELEASE, reason })
          ?.tooltip,
    );

    expect(new Set(tooltips).size).toBe(reasons.length);
    for (const tooltip of tooltips) expect(tooltip).toBeTruthy();
  });

  it("retries a failed install and names the failure", () => {
    const view = appUpdateView({
      state: "failed",
      code: "signature",
      version: "0.3.1",
      releaseUrl: RELEASE,
    });

    expect(view).toMatchObject({
      text: "Update failed",
      tone: "danger",
      action: { kind: "install" },
    });
    expect(view?.tooltip).toContain("The update's signature does not match");
  });

  it("checks again after a failed check that offered no build", () => {
    const view = appUpdateView({ state: "failed", code: "offline" });

    expect(view).toMatchObject({ text: "Update failed", action: { kind: "check" } });
    expect(view?.tooltip).toContain("Could not reach the update server");
  });

  it("opens the release page after the system refused the install", () => {
    const view = appUpdateView({
      state: "failed",
      code: "refused",
      version: "0.3.1",
      releaseUrl: "https://example.test/release",
    });

    expect(view?.action).toEqual({ kind: "open", url: "https://example.test/release" });
    expect(view?.tooltip).toContain("Open the release page");
  });

  it("has a distinct text for every failure code", () => {
    const codes: AppUpdateFailureCode[] = [
      "offline",
      "manifest_invalid",
      "no_target",
      "signature",
      "download",
      "install",
      "refused",
    ];
    const tooltips = codes.map((code) => appUpdateView({ state: "failed", code })?.tooltip);

    expect(new Set(tooltips).size).toBe(codes.length);
  });
});
