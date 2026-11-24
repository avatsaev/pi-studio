//! Dependency layering rules.
//!
//! The rule engine works on a small model so it can be unit-tested; `from_metadata` builds that
//! model from `cargo metadata`. A new crate must be added to [`TABLE`] or the check fails.

use serde_json::Value;

/// The package-name prefix of this workspace's crates.
pub const PREFIX: &str = "pistudiodesktop-";

/// Where a workspace crate sits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Class {
    /// A layered crate: it may depend only on crates in lower layers.
    Layer(u8),
    /// Layer 0 and no workspace dependency at all (format parsers, codecs: publishable alone).
    Standalone,
    /// Test tooling: other crates may use it only as a dev-dependency.
    Testkit,
    /// Binaries and build tooling: exempt from the rules.
    Exempt,
}

impl Class {
    fn layer(self) -> Option<u8> {
        match self {
            Class::Layer(l) => Some(l),
            Class::Standalone => Some(0),
            Class::Testkit => Some(UI_LAYER),
            Class::Exempt => None,
        }
    }
}

/// The layering table. Names are package names without [`PREFIX`].
///
/// ```text
/// L0  foundation (geometry, units, storage containers) and standalone format crates
/// L1  model               the app's settings and stored state: pure data
/// L2  algorithms          domain algorithms
/// L3  store, rendering    files on disk, renderers
/// L4  io, plugins         import/export orchestration
/// L5  engine              Session + command registry
/// L6  shell, automation  the shell (what the webview draws), the MCP server
/// L7  net                 sockets: the dial and the loopback proxy. Only `transfer` and an app binary may use it, and it uses no UI crate
/// L8  transfer            the transfer engine: the daemon's file-transfer protocol over its own connection. Only an app binary may use it, and it uses no UI crate
/// L8  relay, ssh          the relay client (protocol 2) and the SSH client: each opens a daemon socket through `net`. Only an app binary may use them, and they use no UI crate
/// L8  install             the daemon installer: download, verify, unpack, version layout. Uses no socket of `net` (it has its own HTTP client). Only an app binary may use it, and it uses no UI crate
/// ```
pub const TABLE: &[(&str, Class)] = &[
    ("model", Class::Layer(1)),
    ("store", Class::Layer(3)),
    ("secrets", Class::Layer(3)),
    ("engine", Class::Layer(5)),
    ("shell", Class::Layer(6)),
    // Above the shell, so a layered crate (engine, shell) cannot depend on it: only `transfer` and apps may.
    ("net", Class::Layer(7)),
    // Above `net`, which it dials through, and above the shell, so that neither the shell nor the engine can depend on it: only apps may.
    ("transfer", Class::Layer(8)),
    // Beside `transfer`: above `net`, which they dial through, and above the shell and the engine, so only apps may use them.
    ("relay", Class::Layer(8)),
    ("ssh", Class::Layer(8)),
    // Beside `transfer`: above the shell and the engine, so only apps may use it. It downloads with `reqwest`, not through `net`.
    ("install", Class::Layer(8)),
    ("testkit", Class::Testkit),
    // Apps and tooling.
    ("pistudiodesktop", Class::Exempt),
    ("cli", Class::Exempt),
    ("ipc-bench", Class::Exempt),
    ("xtask", Class::Exempt),
];

/// Explicit orderings within a layer (earlier may be used by later), e.g. `&["render", "gpu"]`
/// when a GPU backend reuses the CPU reference. `secrets` writes `secrets.json` through `store`.
pub const INTRA_LAYER_ORDER: &[&[&str]] = &[&["store", "secrets"]];

/// External crates that are a UI toolkit, a webview or a windowing dependency. A trailing `*`
/// is a prefix. wgpu is not listed: a renderer below the UI layer may use the GPU, but no
/// windows and no webviews.
pub const UI_CRATES: &[&str] = &["tauri*", "wry", "tao", "muda", "webview2*", "webkit2gtk*", "winit", "rfd"];

/// The one layer allowed to use [`UI_CRATES`]. Not "this layer and above": `net` and `transfer` sit above
/// it so that nothing layered below can depend on them, which does not make them UI crates, and a socket
/// crate or an engine must never be able to pull in a window.
pub const UI_LAYER: u8 = 6;

/// The highest layer in [`TABLE`]. Apps (exempt) sit one above it.
pub const TOP_LAYER: u8 = 8;

/// Packages that must never be in `Cargo.lock`: `aws-lc-rs` and `aws-lc-sys` need cmake or NASM on Windows.
/// The TLS provider and russh are both built with `ring` (workspace `Cargo.toml`).
const FORBIDDEN_PACKAGES: &[&str] = &["aws-lc-rs", "aws-lc-sys"];

/// The names in `lock` (the text of `Cargo.lock`) that are in [`FORBIDDEN_PACKAGES`].
pub fn forbidden_in_lock(lock: &str) -> Vec<String> {
    lock.lines().filter_map(|l| l.strip_prefix("name = \"")?.strip_suffix('"')).filter(|name| FORBIDDEN_PACKAGES.contains(name)).map(str::to_string).collect()
}

pub fn short_name(pkg: &str) -> &str {
    pkg.strip_prefix(PREFIX).unwrap_or(pkg)
}

pub fn classify(pkg: &str) -> Option<Class> {
    let short = short_name(pkg);
    TABLE.iter().find(|(name, _)| *name == short).map(|(_, class)| *class)
}

fn intra_layer_allowed(from: &str, to: &str) -> bool {
    let (from, to) = (short_name(from), short_name(to));
    INTRA_LAYER_ORDER.iter().any(|chain| match (chain.iter().position(|n| *n == from), chain.iter().position(|n| *n == to)) {
        (Some(f), Some(t)) => t < f,
        _ => false,
    })
}

fn is_ui_crate(name: &str) -> bool {
    UI_CRATES.iter().any(|p| match p.strip_suffix('*') {
        Some(prefix) => name.starts_with(prefix),
        None => name == *p,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DepKind {
    Normal,
    Dev,
    Build,
}

#[derive(Debug, Clone)]
pub struct Dep {
    pub name: String,
    pub kind: DepKind,
    /// `true` if the dependency is a workspace member.
    pub workspace: bool,
}

#[derive(Debug, Clone)]
pub struct Crate {
    pub name: String,
    pub deps: Vec<Dep>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Violation {
    Unregistered { krate: String },
    Upward { krate: String, dep: String, from: u8, to: u8 },
    StandaloneHasWorkspaceDep { krate: String, dep: String },
    TestkitAsNormalDep { krate: String },
    UiOutsideUiLayer { krate: String, dep: String, layer: u8 },
}

impl std::fmt::Display for Violation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Violation::Unregistered { krate } => write!(f, "{krate}: not in the layering table (xtask/src/layers.rs TABLE)"),
            Violation::Upward { krate, dep, from, to } => write!(f, "{krate} (L{from}) depends on {dep} (L{to}): a crate may depend only on lower layers"),
            Violation::StandaloneHasWorkspaceDep { krate, dep } => write!(f, "{krate} is standalone but depends on workspace crate {dep}"),
            Violation::TestkitAsNormalDep { krate } => write!(f, "{krate} uses the testkit outside [dev-dependencies]"),
            Violation::UiOutsideUiLayer { krate, dep, layer } => write!(f, "{krate} (L{layer}) depends on UI crate {dep}: only L{UI_LAYER} may"),
        }
    }
}

/// Check all rules. Returns violations sorted for stable output.
pub fn check(crates: &[Crate]) -> Vec<Violation> {
    let mut out = Vec::new();
    for c in crates {
        let Some(class) = classify(&c.name) else {
            out.push(Violation::Unregistered { krate: c.name.clone() });
            continue;
        };
        let Some(layer) = class.layer() else { continue };
        for d in &c.deps {
            // A self dev-dependency (to enable features in tests) is fine.
            if d.name == c.name {
                continue;
            }
            if !d.workspace {
                if layer != UI_LAYER && is_ui_crate(&d.name) {
                    out.push(Violation::UiOutsideUiLayer { krate: c.name.clone(), dep: d.name.clone(), layer });
                }
                continue;
            }
            if class == Class::Standalone {
                out.push(Violation::StandaloneHasWorkspaceDep { krate: c.name.clone(), dep: d.name.clone() });
                continue;
            }
            match classify(&d.name) {
                // An unregistered dependency is reported on its own entry.
                None => {}
                Some(Class::Testkit) if d.kind != DepKind::Dev => out.push(Violation::TestkitAsNormalDep { krate: c.name.clone() }),
                Some(Class::Testkit) => {}
                Some(dep_class) => {
                    // Apps (exempt) sit above every layer: nothing layered may depend on one.
                    let to = dep_class.layer().unwrap_or(TOP_LAYER + 1);
                    if to >= layer && !(to == layer && intra_layer_allowed(&c.name, &d.name)) {
                        out.push(Violation::Upward { krate: c.name.clone(), dep: d.name.clone(), from: layer, to });
                    }
                }
            }
        }
    }
    out.sort_by_key(|v| v.to_string());
    out.dedup();
    out
}

/// Build the model from `cargo metadata --format-version 1 --no-deps`.
pub fn from_metadata(meta: &Value) -> Result<Vec<Crate>, String> {
    let pkgs = meta["packages"].as_array().ok_or("metadata: no packages array")?;
    let members: Vec<&str> = pkgs.iter().filter_map(|p| p["name"].as_str()).collect();
    let mut out = Vec::new();
    for p in pkgs {
        let name = p["name"].as_str().ok_or("package without name")?.to_owned();
        let mut deps = Vec::new();
        for d in p["dependencies"].as_array().into_iter().flatten() {
            let dep_name = d["name"].as_str().unwrap_or_default().to_owned();
            let kind = match d["kind"].as_str() {
                Some("dev") => DepKind::Dev,
                Some("build") => DepKind::Build,
                _ => DepKind::Normal,
            };
            let workspace = members.contains(&dep_name.as_str()) || d["path"].is_string();
            deps.push(Dep { name: dep_name, kind, workspace });
        }
        out.push(Crate { name, deps });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub fn describe(class: Option<Class>) -> String {
    match class {
        Some(Class::Layer(l)) => format!("L{l}"),
        Some(Class::Standalone) => "L0 standalone".into(),
        Some(Class::Testkit) => "testkit".into(),
        Some(Class::Exempt) => "app/tooling".into(),
        None => "UNREGISTERED".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn krate(name: &str, deps: &[(&str, DepKind, bool)]) -> Crate {
        Crate { name: name.into(), deps: deps.iter().map(|(n, kind, workspace)| Dep { name: (*n).into(), kind: *kind, workspace: *workspace }).collect() }
    }

    #[test]
    fn downward_dependencies_pass() {
        let crates = [
            krate(
                "pistudiodesktop-engine",
                &[("pistudiodesktop-model", DepKind::Normal, true), ("pistudiodesktop-testkit", DepKind::Dev, true), ("serde_json", DepKind::Normal, false)],
            ),
            krate("pistudiodesktop-shell", &[("pistudiodesktop-engine", DepKind::Normal, true), ("serde", DepKind::Normal, false)]),
            krate("pistudiodesktop", &[("pistudiodesktop-shell", DepKind::Normal, true), ("tauri", DepKind::Normal, false)]),
        ];
        assert_eq!(check(&crates), []);
    }

    #[test]
    fn each_rule_reports_its_violation() {
        let crates = [
            krate("pistudiodesktop-model", &[("pistudiodesktop-engine", DepKind::Normal, true), ("tauri", DepKind::Normal, false)]),
            krate("pistudiodesktop-store", &[("pistudiodesktop-testkit", DepKind::Normal, true), ("tauri-plugin-dialog", DepKind::Dev, false)]),
            krate("pistudiodesktop-engine", &[("pistudiodesktop", DepKind::Normal, true)]),
            krate("pistudiodesktop-new", &[]),
        ];
        let found: Vec<String> = check(&crates).iter().map(ToString::to_string).collect();
        assert_eq!(found.len(), 6, "{found:#?}");
        for expected in [
            "pistudiodesktop-model (L1) depends on pistudiodesktop-engine (L5)",
            "pistudiodesktop-model (L1) depends on UI crate tauri",
            "pistudiodesktop-store (L3) depends on UI crate tauri-plugin-dialog",
            "pistudiodesktop-store uses the testkit outside [dev-dependencies]",
            "pistudiodesktop-engine (L5) depends on pistudiodesktop (L9)",
            "pistudiodesktop-new: not in the layering table",
        ] {
            assert!(found.iter().any(|f| f.starts_with(expected)), "missing `{expected}` in {found:#?}");
        }
    }

    #[test]
    fn net_is_usable_by_transfer_and_apps_only() {
        let crates = [
            krate("pistudiodesktop-engine", &[("pistudiodesktop-net", DepKind::Normal, true)]),
            krate("pistudiodesktop-shell", &[("pistudiodesktop-net", DepKind::Normal, true)]),
            krate("pistudiodesktop-store", &[("pistudiodesktop-net", DepKind::Dev, true)]),
            krate("pistudiodesktop-transfer", &[("pistudiodesktop-net", DepKind::Normal, true)]),
            krate("pistudiodesktop", &[("pistudiodesktop-net", DepKind::Normal, true)]),
            krate("pistudiodesktop-net", &[]),
        ];
        let found: Vec<String> = check(&crates).iter().map(ToString::to_string).collect();
        assert_eq!(found.len(), 3, "{found:#?}");
        for expected in [
            "pistudiodesktop-engine (L5) depends on pistudiodesktop-net (L7)",
            "pistudiodesktop-shell (L6) depends on pistudiodesktop-net (L7)",
            "pistudiodesktop-store (L3) depends on pistudiodesktop-net (L7)",
        ] {
            assert!(found.iter().any(|f| f.starts_with(expected)), "missing `{expected}` in {found:#?}");
        }
    }

    #[test]
    fn forbidden_packages_are_found_in_a_lock() {
        let lock = "[[package]]\nname = \"ring\"\nversion = \"0.17\"\n\n[[package]]\nname = \"aws-lc-sys\"\nversion = \"0.20\"\n\n[[package]]\nname = \"aws-lc-rs-like\"\n";
        assert_eq!(forbidden_in_lock(lock), vec!["aws-lc-sys".to_string()]);
        assert!(forbidden_in_lock("[[package]]\nname = \"ring\"\n").is_empty());
    }

    #[test]
    fn relay_and_ssh_are_usable_by_apps_only() {
        for name in ["relay", "ssh"] {
            let full = format!("pistudiodesktop-{name}");
            let crates = [
                krate("pistudiodesktop-engine", &[(full.as_str(), DepKind::Normal, true)]),
                krate("pistudiodesktop-shell", &[(full.as_str(), DepKind::Normal, true)]),
                krate("pistudiodesktop-transfer", &[(full.as_str(), DepKind::Normal, true)]),
                krate("pistudiodesktop-net", &[(full.as_str(), DepKind::Normal, true)]),
                krate("pistudiodesktop", &[(full.as_str(), DepKind::Normal, true)]),
                krate(full.as_str(), &[("pistudiodesktop-net", DepKind::Normal, true)]),
            ];
            let found: Vec<String> = check(&crates).iter().map(ToString::to_string).collect();
            assert_eq!(found.len(), 4, "{name}: {found:#?}");
            for lower in ["engine (L5)", "shell (L6)", "net (L7)", "transfer (L8)"] {
                assert!(
                    found.iter().any(|f| f.starts_with(&format!("pistudiodesktop-{lower} depends on {full} (L8)"))),
                    "{name}: missing {lower} in {found:#?}"
                );
            }
        }
    }

    #[test]
    fn install_is_usable_by_apps_only() {
        let full = "pistudiodesktop-install";
        let crates = [
            krate("pistudiodesktop-engine", &[(full, DepKind::Normal, true)]),
            krate("pistudiodesktop-shell", &[(full, DepKind::Normal, true)]),
            krate("pistudiodesktop-net", &[(full, DepKind::Normal, true)]),
            krate("pistudiodesktop-transfer", &[(full, DepKind::Normal, true)]),
            krate("pistudiodesktop-relay", &[(full, DepKind::Normal, true)]),
            krate("pistudiodesktop", &[(full, DepKind::Normal, true)]),
            krate(full, &[]),
        ];
        let found: Vec<String> = check(&crates).iter().map(ToString::to_string).collect();
        assert_eq!(found.len(), 5, "{found:#?}");
        for lower in ["engine (L5)", "shell (L6)", "net (L7)", "transfer (L8)", "relay (L8)"] {
            assert!(found.iter().any(|f| f.starts_with(&format!("pistudiodesktop-{lower} depends on {full} (L8)"))), "missing {lower} in {found:#?}");
        }
    }

    #[test]
    fn transfer_is_usable_by_apps_only() {
        let crates = [
            krate("pistudiodesktop-engine", &[("pistudiodesktop-transfer", DepKind::Normal, true)]),
            krate("pistudiodesktop-shell", &[("pistudiodesktop-transfer", DepKind::Normal, true)]),
            krate("pistudiodesktop-net", &[("pistudiodesktop-transfer", DepKind::Normal, true)]),
            krate("pistudiodesktop", &[("pistudiodesktop-transfer", DepKind::Normal, true), ("pistudiodesktop-net", DepKind::Normal, true)]),
            krate("pistudiodesktop-transfer", &[("pistudiodesktop-net", DepKind::Normal, true), ("pistudiodesktop-testkit", DepKind::Dev, true)]),
            krate("pistudiodesktop-testkit", &[]),
        ];
        let found: Vec<String> = check(&crates).iter().map(ToString::to_string).collect();
        assert_eq!(found.len(), 3, "{found:#?}");
        for expected in [
            "pistudiodesktop-engine (L5) depends on pistudiodesktop-transfer (L8)",
            "pistudiodesktop-shell (L6) depends on pistudiodesktop-transfer (L8)",
            "pistudiodesktop-net (L7) depends on pistudiodesktop-transfer (L8)",
        ] {
            assert!(found.iter().any(|f| f.starts_with(expected)), "missing `{expected}` in {found:#?}");
        }
    }

    #[test]
    fn transfer_may_not_use_an_app_or_a_ui_crate() {
        let crates = [
            krate(
                "pistudiodesktop-transfer",
                &[
                    ("tauri", DepKind::Normal, false),
                    ("tauri-plugin-dialog", DepKind::Dev, false),
                    ("pistudiodesktop", DepKind::Normal, true),
                    ("tokio", DepKind::Normal, false),
                ],
            ),
            krate("pistudiodesktop", &[]),
        ];
        let found: Vec<String> = check(&crates).iter().map(ToString::to_string).collect();
        assert_eq!(found.len(), 3, "{found:#?}");
        for expected in [
            "pistudiodesktop-transfer (L8) depends on UI crate tauri: only L6 may",
            "pistudiodesktop-transfer (L8) depends on UI crate tauri-plugin-dialog: only L6 may",
            "pistudiodesktop-transfer (L8) depends on pistudiodesktop (L9)",
        ] {
            assert!(found.iter().any(|f| f.starts_with(expected)), "missing `{expected}` in {found:#?}");
        }
    }

    #[test]
    fn every_layer_in_the_table_is_at_most_the_top_layer() {
        for (name, class) in TABLE {
            if let Some(layer) = class.layer() {
                assert!(layer <= TOP_LAYER, "{name} is above TOP_LAYER");
            }
        }
    }

    #[test]
    fn only_the_ui_layer_may_use_a_ui_crate_so_net_may_not() {
        let crates = [
            krate("pistudiodesktop-shell", &[("tauri", DepKind::Normal, false)]),
            krate("pistudiodesktop-net", &[("tauri", DepKind::Normal, false), ("wry", DepKind::Dev, false), ("tokio", DepKind::Normal, false)]),
            krate("pistudiodesktop", &[("pistudiodesktop-net", DepKind::Normal, true), ("tauri", DepKind::Normal, false)]),
        ];
        let found: Vec<String> = check(&crates).iter().map(ToString::to_string).collect();
        assert_eq!(found.len(), 2, "{found:#?}");
        for expected in ["pistudiodesktop-net (L7) depends on UI crate tauri: only L6 may", "pistudiodesktop-net (L7) depends on UI crate wry: only L6 may"] {
            assert!(found.iter().any(|f| f == expected), "missing `{expected}` in {found:#?}");
        }
    }

    #[test]
    fn secrets_may_use_store_and_not_the_other_way_round() {
        let allowed = [
            krate("pistudiodesktop-secrets", &[("pistudiodesktop-store", DepKind::Normal, true), ("pistudiodesktop-model", DepKind::Normal, true)]),
            krate("pistudiodesktop-store", &[]),
        ];
        assert_eq!(check(&allowed), []);
        let reversed = [krate("pistudiodesktop-store", &[("pistudiodesktop-secrets", DepKind::Normal, true)]), krate("pistudiodesktop-secrets", &[])];
        let found: Vec<String> = check(&reversed).iter().map(ToString::to_string).collect();
        assert_eq!(found.len(), 1, "{found:#?}");
        assert!(found[0].starts_with("pistudiodesktop-store (L3) depends on pistudiodesktop-secrets (L3)"), "{found:#?}");
    }
}
