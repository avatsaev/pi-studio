// English translation resource — canonical key shape.
// All other locales mirror this structure; values may differ.
// features/localization.md § Engine

const en = {
  common: {
    errors: {
      unknown: "Something went wrong",
      notFound: "Not found",
      offline: "You appear to be offline",
    },
    actions: {
      retry: "Try again",
      cancel: "Cancel",
      confirm: "Confirm",
      save: "Save",
      delete: "Delete",
      close: "Close",
      back: "Back",
      done: "Done",
      open: "Open",
      add: "Add",
      edit: "Edit",
      remove: "Remove",
      copy: "Copy",
      copied: "Copied",
      reset: "Reset",
      search: "Search",
    },
  },
  sessions: {
    title: "Sessions",
    empty: "No sessions yet",
    loadMore: "Load more",
    host: {
      all: "All hosts",
    },
  },
  schedules: {
    title: "Schedules",
    empty: "No schedules yet",
    filter: {
      all: "All",
      active: "Active",
      ended: "Ended",
    },
  },
  settings: {
    title: "Settings",
    general: {
      title: "General",
      language: {
        title: "Language",
        system: "System",
        options: {
          en: "English",
          ar: "Arabic",
          es: "Spanish",
          fr: "French",
          ja: "Japanese",
          ptBR: "Portuguese (Brazil)",
          ru: "Russian",
          zhCN: "Chinese (Simplified)",
        },
      },
    },
    appearance: {
      title: "Appearance",
    },
    daemon: {
      title: "Daemon",
      localDaemon: "Run a daemon on this computer",
      disableWarning: "You will see the welcome screen on next launch until you add a host.",
    },
    shortcuts: {
      title: "Shortcuts",
      resetAll: "Reset all shortcuts",
      resetRow: "Reset",
    },
    permissions: {
      title: "Permissions",
      notifications: "Notifications",
      microphone: "Microphone",
      granted: "Granted",
      denied: "Denied",
      request: "Request",
      openSettings: "Open system settings",
    },
    diagnostics: {
      title: "Diagnostics",
      copyLogs: "Copy logs",
      openIssue: "Open issue",
      docs: "Docs",
    },
    about: {
      title: "About",
    },
    connections: {
      title: "Connections",
    },
    providers: {
      title: "Providers",
      usage: "Usage",
    },
  },
  composer: {
    placeholder: "Message…",
    send: "Send",
    cancel: "Stop",
    clientCommands: {
      archiveAgent: "Archive agent",
      newWorkspace: "New workspace",
    },
  },
  rewind: {
    tooltip: "Rewind",
    mode: {
      conversation: "Conversation",
      files: "Files",
      both: "Both",
    },
    confirm: "Rewind to here",
    cancel: "Cancel rewind",
    warning: "This will rewind the conversation. Files will be reverted to their state at this point.",
  },
  shell: {
    commandCenter: {
      placeholder: "Search actions and agents…",
      noResults: "No results",
    },
    sidebar: {
      addProject: "Add a project",
      home: "Home",
      settings: "Settings",
      sessions: "Sessions",
    },
  },
  openProject: {
    addProject: "Add a project",
    importSession: "Import session",
    setupProviders: "Setup providers",
    pairDevice: "Pair device",
    useThisComputer: "Use this computer",
  },
  welcome: {
    title: "{{productName}}",
    subtitle: "Your local-first AI coding agent",
    directConnection: "Direct connection",
    pasteLink: "Paste pairing link",
    scanQR: "Scan QR code",
    useThisComputer: "Use this computer",
  },
  providerUsage: {
    title: "Usage",
    noData: "No usage data",
    balance: "Balance",
    rateLimit: "Rate limit",
    resetsIn: "Resets in {{duration}}",
  },
} as const;

export default en;
export type TranslationSchema = typeof en;
