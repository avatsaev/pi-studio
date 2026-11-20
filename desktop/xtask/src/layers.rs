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
            Class::Testkit => Some(UI_MIN_LAYER),
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
/// ```
pub const TABLE: &[(&str, Class)] = &[
    ("model", Class::Layer(1)),
    ("store", Class::Layer(3)),
    ("engine", Class::Layer(5)),
    ("shell", Class::Layer(6)),
    ("testkit", Class::Testkit),
    // Apps and tooling.
    ("pistudiodesktop", Class::Exempt),
    ("cli", Class::Exempt),
    ("xtask", Class::Exempt),
];

/// Explicit orderings within a layer (earlier may be used by later), e.g. `&["render", "gpu"]`
/// when a GPU backend reuses the CPU reference.
pub const INTRA_LAYER_ORDER: &[&[&str]] = &[];

/// External crates that are a UI toolkit, a webview or a windowing dependency. A trailing `*`
/// is a prefix. wgpu is not listed: a renderer below the UI layer may use the GPU, but no
/// windows and no webviews.
pub const UI_CRATES: &[&str] = &["tauri*", "wry", "tao", "muda", "webview2*", "webkit2gtk*", "winit", "rfd"];

/// The first layer allowed to use [`UI_CRATES`].
pub const UI_MIN_LAYER: u8 = 6;

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
    UiBelowUiLayer { krate: String, dep: String, layer: u8 },
}

impl std::fmt::Display for Violation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Violation::Unregistered { krate } => write!(f, "{krate}: not in the layering table (xtask/src/layers.rs TABLE)"),
            Violation::Upward { krate, dep, from, to } => write!(f, "{krate} (L{from}) depends on {dep} (L{to}): a crate may depend only on lower layers"),
            Violation::StandaloneHasWorkspaceDep { krate, dep } => write!(f, "{krate} is standalone but depends on workspace crate {dep}"),
            Violation::TestkitAsNormalDep { krate } => write!(f, "{krate} uses the testkit outside [dev-dependencies]"),
            Violation::UiBelowUiLayer { krate, dep, layer } => write!(f, "{krate} (L{layer}) depends on UI crate {dep}: only L{UI_MIN_LAYER} and above may"),
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
                if layer < UI_MIN_LAYER && is_ui_crate(&d.name) {
                    out.push(Violation::UiBelowUiLayer { krate: c.name.clone(), dep: d.name.clone(), layer });
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
                    let to = dep_class.layer().unwrap_or(UI_MIN_LAYER + 1);
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
            "pistudiodesktop-engine (L5) depends on pistudiodesktop (L7)",
            "pistudiodesktop-new: not in the layering table",
        ] {
            assert!(found.iter().any(|f| f.starts_with(expected)), "missing `{expected}` in {found:#?}");
        }
    }
}
