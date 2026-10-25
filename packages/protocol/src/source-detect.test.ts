import { describe, expect, it } from "vitest";

import { detectSkillSource } from "./source-detect.js";

// Table test covering every row of swe/architecture/pi-resource-management.md § Source kinds,
// plus the rejects called out in sprint-077/task-002's task file (relative paths, bare words,
// non-git http(s) file URLs).
describe("detectSkillSource (sprint-077/task-002)", () => {
  const accepted: Array<[input: string, kind: string]> = [
    // npm:<name>[@<version>]
    ["npm:some-pack", "pi_npm"],
    ["npm:some-pack@1.2.3", "pi_npm"],
    ["npm:@scope/some-pack", "pi_npm"],
    ["npm:@scope/some-pack@2.0.0", "pi_npm"],
    // git:<url>[@<ref>]
    ["git:https://example.com/repo.git", "pi_git"],
    ["git:https://example.com/repo.git@main", "pi_git"],
    ["git:git@example.com:owner/repo.git", "pi_git"],
    // owner/repo, owner/repo@skill
    ["vercel-labs/agent-skills", "skills_repo"],
    ["vercel-labs/agent-skills@code-review", "skills_repo"],
    // GitHub/GitLab URLs, incl. /tree/<ref>/<path>
    ["https://github.com/vercel-labs/agent-skills", "skills_repo"],
    ["https://github.com/vercel-labs/agent-skills/tree/main/skills/code-review", "skills_repo"],
    ["https://www.github.com/vercel-labs/agent-skills", "skills_repo"],
    ["https://gitlab.com/owner/repo", "skills_repo"],
    ["https://gitlab.com/owner/repo/-/tree/main/skills/code-review", "skills_repo"],
    // git@host:…
    ["git@github.com:vercel-labs/agent-skills.git", "skills_repo"],
    ["git@github.com:vercel-labs/agent-skills", "skills_repo"],
    // ssh://…
    ["ssh://git@github.com/vercel-labs/agent-skills.git", "skills_repo"],
    // *.git (generic host, not github/gitlab)
    ["https://example.com/some/repo.git", "skills_repo"],
    ["http://internal-forge.local/team/repo.git", "skills_repo"],
    // Absolute and ~ paths
    ["/home/user/my-skills", "local_path"],
    ["/home/user/my-skills/", "local_path"],
    ["~/my-skills", "local_path"],
    ["~", "local_path"],
    // Surrounding whitespace is trimmed, not rejected.
    ["  npm:some-pack  ", "pi_npm"],
  ];

  it.each(accepted)("classifies %j as %s", (input, kind) => {
    const result = detectSkillSource(input);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe(kind);
    expect(result?.normalized).toBe(input.trim());
  });

  const rejected: string[] = [
    "",
    "   ",
    // relative paths
    "./relative/path",
    "../skills",
    "relative/path/deeper",
    // bare words
    "lodash",
    "skills",
    // non-git http(s) file URLs
    "https://example.com/README.md",
    "http://example.com/archive.zip",
    "https://example.com/docs/index.html",
  ];

  it.each(rejected)("rejects %j as null", (input) => {
    expect(detectSkillSource(input)).toBeNull();
  });
});
