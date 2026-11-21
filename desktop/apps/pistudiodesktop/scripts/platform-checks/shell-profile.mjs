// The scratch home of a macOS run: what puts the CLI on PATH, and the environment the app starts
// in. Pure text and objects, so the unit tests read them without a Mac.

export const SHELLS = {
  zsh: { path: "/bin/zsh", profile: ".zprofile" },
  bash: { path: "/bin/bash", profile: ".bash_profile" },
};

/** `text` as one single-quoted shell word. */
export function shellQuote(text) {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * The login shell's start-up file. It is the only thing that puts `pi-studio` and `node` on PATH,
 * and the only thing that sets `PI_STUDIO_HOME`: the app is started without them. A login,
 * interactive shell reads `~/.zprofile` (zsh) or `~/.bash_profile` (bash), after `/etc/profile`
 * has put the system directories on PATH.
 */
export function profileText({ binDirs, piHome }) {
  return [
    "# Written by platform-checks.mjs. Nothing else puts the CLI or node on PATH.",
    `export PATH=${shellQuote(binDirs.join(":"))}:"$PATH"`,
    `export PI_STUDIO_HOME=${shellQuote(piHome)}`,
    "",
  ].join("\n");
}

/**
 * The `pi-studio` the run installs: the repository's CLI, with the daemon's address fixed so the
 * run does not use 6767 (the app never passes `--host`). `node` is looked up on PATH, as an
 * installed `pi-studio` script does, so the shell environment has to supply it too.
 */
export function cliWrapperText({ cliEntry, host }) {
  return `#!/bin/sh\nexec node ${shellQuote(cliEntry)} --host ${shellQuote(host)} "$@"\n`;
}

/**
 * The environment of an app launched from the dock: no `PATH` beyond the system's, no `node`, no
 * `PI_STUDIO_*`. launchd gives a GUI app a few variables of its own; these are the ones the app
 * and the webview need. `extra` is added on top.
 */
export function dockEnvironment({ home, shell, tmpdir, user, extra = {} }) {
  return {
    HOME: home,
    USER: user,
    LOGNAME: user,
    SHELL: SHELLS[shell].path,
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    TMPDIR: tmpdir,
    ...extra,
  };
}

/** The display variables of the environment `source`: a Linux run (the rehearsal) has no window server without them; macOS has none to pass. */
export function displayVariables(source) {
  const names = ["DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR"];
  return Object.fromEntries(names.filter((name) => source[name] !== undefined).map((name) => [name, source[name]]));
}
