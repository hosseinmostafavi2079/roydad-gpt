import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function assertReleaseRuns(commit, runs) {
  if (!/^[a-f0-9]{40}$/.test(commit))
    throw new Error("Full commit SHA required");
  for (const workflow of [
    ".github/workflows/ci.yml",
    ".github/workflows/codeql.yml",
  ]) {
    const latest = runs
      .filter(
        (run) =>
          run.path === workflow &&
          run.head_sha === commit &&
          run.event === "push" &&
          run.head_branch === "main",
      )
      .sort(
        (a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt,
      )[0];
    if (
      !latest ||
      latest.status !== "completed" ||
      latest.conclusion !== "success"
    )
      throw new Error(`Exact-commit release gate unavailable: ${workflow}`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const commit = process.argv[2];
  if (!/^[a-f0-9]{40}$/.test(commit ?? ""))
    throw new Error("Full commit SHA required");
  execFileSync("git", ["fetch", "origin", "main"]);
  execFileSync("git", ["merge-base", "--is-ancestor", commit, "origin/main"]);
  const pages = JSON.parse(
    execFileSync(
      "gh",
      [
        "api",
        "--paginate",
        "--slurp",
        `repos/${process.env.GITHUB_REPOSITORY}/actions/runs?head_sha=${commit}&per_page=100`,
      ],
      { encoding: "utf8" },
    ),
  );
  assertReleaseRuns(
    commit,
    pages.flatMap((page) => page.workflow_runs),
  );
  console.log("Exact commit is on main; Quality Gates and CodeQL succeeded.");
}
