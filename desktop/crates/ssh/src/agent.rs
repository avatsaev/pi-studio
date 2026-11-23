//! The SSH agent's connection: where its socket is, per platform (D18).
//!
//! `Agent::Default` is `SSH_AUTH_SOCK` from the environment the caller read (the login shell's); on Windows, with no
//! such variable, it is the OpenSSH agent's named pipe and then Pageant. No agent, or one that does not answer, is
//! `None`: a login without an agent is not an error.

use russh::keys::agent::client::{AgentClient, AgentStream};

use crate::config::Agent;
use crate::session::Environment;

/// An agent connection of whichever kind the platform gave.
pub(crate) type DynAgent = AgentClient<Box<dyn AgentStream + Send + Unpin>>;

/// The variable the agent's socket is named in when the config does not say.
const DEFAULT_SOCKET_VAR: &str = "SSH_AUTH_SOCK";
/// The OpenSSH agent's pipe on Windows.
#[cfg(windows)]
const WINDOWS_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

/// The socket (or pipe) an `Agent` setting names, `None` for none or an empty variable.
fn named(agent: &Agent, env: &Environment) -> Option<std::ffi::OsString> {
    let value = match agent {
        Agent::Disabled => return None,
        Agent::Socket(path) => path.as_os_str().to_owned(),
        Agent::Env(name) => env.vars.get(name)?.clone(),
        Agent::Default => env.vars.get(DEFAULT_SOCKET_VAR)?.clone(),
    };
    (!value.is_empty()).then_some(value)
}

/// Connects to the agent `agent` names.
#[cfg(unix)]
pub(crate) async fn connect(agent: &Agent, env: &Environment) -> Option<DynAgent> {
    let path = named(agent, env)?;
    AgentClient::connect_uds(path).await.ok().map(AgentClient::dynamic)
}

/// Connects to the agent `agent` names: its pipe, or with no setting the OpenSSH agent's pipe and then Pageant.
#[cfg(windows)]
pub(crate) async fn connect(agent: &Agent, env: &Environment) -> Option<DynAgent> {
    if matches!(agent, Agent::Disabled) {
        return None;
    }
    let pipe = named(agent, env).unwrap_or_else(|| WINDOWS_PIPE.into());
    if let Ok(client) = AgentClient::connect_named_pipe(pipe).await {
        return Some(client.dynamic());
    }
    if matches!(agent, Agent::Default) {
        return AgentClient::connect_pageant().await.ok().map(AgentClient::dynamic);
    }
    None
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::path::PathBuf;

    use super::{Agent, Environment, named};

    fn env(vars: &[(&str, &str)]) -> Environment {
        Environment { home: PathBuf::new(), vars: vars.iter().map(|(name, value)| ((*name).to_owned(), OsString::from(value))).collect() }
    }

    #[test]
    fn default_reads_ssh_auth_sock() {
        assert_eq!(named(&Agent::Default, &env(&[("SSH_AUTH_SOCK", "/run/agent")])), Some(OsString::from("/run/agent")));
        assert_eq!(named(&Agent::Default, &env(&[])), None);
    }

    #[test]
    fn an_empty_variable_is_no_agent() {
        assert_eq!(named(&Agent::Default, &env(&[("SSH_AUTH_SOCK", "")])), None);
    }

    #[test]
    fn identity_agent_names_its_variable_or_socket() {
        let vars = env(&[("SSH_AUTH_SOCK", "/a"), ("MY_AGENT", "/b")]);
        assert_eq!(named(&Agent::Env("MY_AGENT".to_owned()), &vars), Some(OsString::from("/b")));
        assert_eq!(named(&Agent::Env("MISSING".to_owned()), &vars), None);
        assert_eq!(named(&Agent::Socket(PathBuf::from("/c")), &vars), Some(OsString::from("/c")));
    }

    #[test]
    fn identity_agent_none_is_no_agent() {
        assert_eq!(named(&Agent::Disabled, &env(&[("SSH_AUTH_SOCK", "/a")])), None);
    }
}
