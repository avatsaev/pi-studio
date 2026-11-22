//! The resident memory of the app's processes (row B4: "growth of the app's processes").
//!
//! The app and everything it started: the webview's own processes on Linux (WebKitGTK spawns
//! them) and on Windows (WebView2 does). On macOS the web content process is a service of the
//! system, not a child of the app, so the tree holds only the app and the list in the answer
//! says so: read `processes` before trusting a total.
//!
//! No `unsafe` and no extra crate: `/proc` on Linux, `ps` on other Unix systems, PowerShell on
//! Windows. The parsers are plain functions, tested on every platform.

use std::collections::{HashMap, HashSet};
use std::process::Command;

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Proc {
    pub pid: u32,
    pub ppid: u32,
    pub name: String,
    pub rss_kib: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcRss {
    pub pid: u32,
    pub name: String,
    pub rss_kib: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rss {
    pub total_kib: u64,
    pub processes: Vec<ProcRss>,
}

/// The app and its descendants, with what they hold in memory now.
pub fn sample() -> Result<Rss, String> {
    let all = if cfg!(target_os = "linux") {
        read_proc()?
    } else if cfg!(windows) {
        run("powershell", &["-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCRIPT]).and_then(|out| parse_windows(&out))?
    } else {
        run("ps", &["-axo", "pid=,ppid=,rss=,comm="]).map(|out| parse_ps(&out))?
    };
    Ok(summarize(std::process::id(), &all))
}

const WINDOWS_SCRIPT: &str = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize | ConvertTo-Json -Compress";

fn run(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program).args(args).output().map_err(|e| format!("cannot run {program}: {e}"))?;
    if !output.status.success() {
        return Err(format!("{program} failed: {}", String::from_utf8_lossy(&output.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// `root` and every process below it, and the sum of their memory.
pub fn summarize(root: u32, all: &[Proc]) -> Rss {
    let mut children: HashMap<u32, Vec<&Proc>> = HashMap::new();
    for p in all {
        children.entry(p.ppid).or_default().push(p);
    }
    let mut seen = HashSet::from([root]);
    let mut queue = vec![root];
    let mut processes = Vec::new();
    while let Some(pid) = queue.pop() {
        if let Some(p) = all.iter().find(|p| p.pid == pid) {
            processes.push(ProcRss { pid, name: p.name.clone(), rss_kib: p.rss_kib });
        }
        for child in children.get(&pid).into_iter().flatten() {
            // A pid seen twice would be a snapshot torn by a reused pid: do not loop on it.
            if seen.insert(child.pid) {
                queue.push(child.pid);
            }
        }
    }
    processes.sort_by_key(|p| p.pid);
    Rss { total_kib: processes.iter().map(|p| p.rss_kib).sum(), processes }
}

fn read_proc() -> Result<Vec<Proc>, String> {
    let entries = std::fs::read_dir("/proc").map_err(|e| format!("cannot read /proc: {e}"))?;
    let mut stats = Vec::new();
    for entry in entries.flatten() {
        let Some(pid) = entry.file_name().to_str().and_then(|n| n.parse::<u32>().ok()) else { continue };
        // A process may exit between the listing and the read: skip it.
        if let Ok(stat) = std::fs::read_to_string(entry.path().join("stat"))
            && let Some((name, ppid)) = parse_stat(&stat)
        {
            stats.push((pid, ppid, name));
        }
    }
    let root = std::process::id();
    let tree: HashSet<u32> =
        summarize(root, &stats.iter().map(|(pid, ppid, name)| Proc { pid: *pid, ppid: *ppid, name: name.clone(), rss_kib: 0 }).collect::<Vec<_>>())
            .processes
            .iter()
            .map(|p| p.pid)
            .collect();
    Ok(stats
        .into_iter()
        .filter(|(pid, _, _)| tree.contains(pid))
        .map(|(pid, ppid, name)| {
            let rss_kib = std::fs::read_to_string(format!("/proc/{pid}/status")).ok().and_then(|s| parse_status_rss(&s)).unwrap_or(0);
            Proc { pid, ppid, name, rss_kib }
        })
        .collect())
}

/// `(name, ppid)` from `/proc/<pid>/stat`: `pid (name) state ppid …`, where the name may hold
/// spaces and parentheses.
pub fn parse_stat(stat: &str) -> Option<(String, u32)> {
    let open = stat.find('(')?;
    let close = stat.rfind(')')?;
    let name = stat.get(open + 1..close)?.to_string();
    let ppid = stat.get(close + 1..)?.split_whitespace().nth(1)?.parse().ok()?;
    Some((name, ppid))
}

/// `VmRSS` of `/proc/<pid>/status`, in KiB.
pub fn parse_status_rss(status: &str) -> Option<u64> {
    status.lines().find_map(|l| l.strip_prefix("VmRSS:")).and_then(|v| v.split_whitespace().next()).and_then(|v| v.parse().ok())
}

/// `ps -axo pid=,ppid=,rss=,comm=`: three numbers and a command that may hold spaces.
pub fn parse_ps(out: &str) -> Vec<Proc> {
    out.lines()
        .filter_map(|line| {
            let mut it = line.split_whitespace();
            let (pid, ppid, rss) = (it.next()?.parse().ok()?, it.next()?.parse().ok()?, it.next()?.parse().ok()?);
            let name = it.collect::<Vec<_>>().join(" ");
            let name = name.rsplit('/').next().unwrap_or(&name).to_string();
            Some(Proc { pid, ppid, name, rss_kib: rss })
        })
        .collect()
}

/// PowerShell's JSON: an array of processes, or one object when there is only one.
pub fn parse_windows(out: &str) -> Result<Vec<Proc>, String> {
    let json: serde_json::Value = serde_json::from_str(out.trim()).map_err(|e| format!("PowerShell's answer is not JSON: {e}"))?;
    let items = match &json {
        serde_json::Value::Array(items) => items.as_slice(),
        single => std::slice::from_ref(single),
    };
    let number = |v: &serde_json::Value, key: &str| v.get(key).and_then(serde_json::Value::as_u64);
    Ok(items
        .iter()
        .filter_map(|v| {
            Some(Proc {
                pid: u32::try_from(number(v, "ProcessId")?).ok()?,
                ppid: u32::try_from(number(v, "ParentProcessId")?).ok()?,
                name: v.get("Name").and_then(serde_json::Value::as_str).unwrap_or("").to_string(),
                rss_kib: number(v, "WorkingSetSize").unwrap_or(0) / 1024,
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pid: u32, ppid: u32, rss_kib: u64) -> Proc {
        Proc { pid, ppid, name: format!("p{pid}"), rss_kib }
    }

    #[test]
    fn the_tree_below_the_root_is_summed_and_nothing_else() {
        let all = [p(1, 0, 1000), p(10, 1, 100), p(11, 10, 200), p(12, 10, 300), p(20, 1, 5000), p(30, 11, 40)];
        let rss = summarize(10, &all);
        assert_eq!(rss.total_kib, 100 + 200 + 300 + 40);
        assert_eq!(rss.processes.iter().map(|p| p.pid).collect::<Vec<_>>(), [10, 11, 12, 30]);
    }

    #[test]
    fn a_cycle_in_a_torn_snapshot_does_not_loop() {
        let rss = summarize(1, &[p(1, 2, 10), p(2, 1, 20)]);
        assert_eq!(rss.total_kib, 30);
    }

    #[test]
    fn a_missing_root_is_an_empty_sum() {
        assert_eq!(summarize(99, &[p(1, 0, 10)]).total_kib, 0);
    }

    #[test]
    fn proc_stat_and_status_are_parsed() {
        assert_eq!(parse_stat("4242 (WebKitWebProcess) S 4000 4242 4242 0 -1 4194560"), Some(("WebKitWebProcess".into(), 4000)));
        assert_eq!(parse_stat("7 (a (b) c) R 6 7"), Some(("a (b) c".into(), 6)));
        assert_eq!(parse_stat("garbage"), None);
        assert_eq!(parse_stat("1 (x) S"), None);
        assert_eq!(parse_status_rss("Name:\tx\nVmPeak:\t 10 kB\nVmRSS:\t  123456 kB\nThreads:\t1\n"), Some(123_456));
        assert_eq!(parse_status_rss("Name:\tkthreadd\n"), None);
    }

    #[test]
    fn ps_output_is_parsed() {
        let out = "  1     0  1024 /sbin/launchd\n 50     1 20480 /Applications/Pi Studio IPC Bench.app/Contents/MacOS/ipc-bench\nbad line\n";
        let procs = parse_ps(out);
        assert_eq!(procs.len(), 2);
        assert_eq!(procs[1], Proc { pid: 50, ppid: 1, name: "ipc-bench".into(), rss_kib: 20480 });
    }

    #[test]
    fn powershell_json_is_parsed_as_array_or_object() {
        let many = r#"[{"ProcessId":4,"ParentProcessId":0,"Name":"System","WorkingSetSize":8192},{"ProcessId":9,"ParentProcessId":4,"Name":"a.exe","WorkingSetSize":null}]"#;
        let procs = parse_windows(many).unwrap();
        assert_eq!((procs[0].rss_kib, procs[1].rss_kib, procs[1].ppid), (8, 0, 4));
        let one = r#"{"ProcessId":4,"ParentProcessId":0,"Name":"System","WorkingSetSize":4096}"#;
        assert_eq!(parse_windows(one).unwrap().len(), 1);
        assert!(parse_windows("not json").is_err());
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn this_process_is_in_its_own_sample() {
        let rss = sample().unwrap();
        let me = std::process::id();
        assert!(rss.processes.iter().any(|p| p.pid == me && p.rss_kib > 0), "{rss:?}");
    }
}
