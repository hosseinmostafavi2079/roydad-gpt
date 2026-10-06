import { describe, expect, it } from "vitest";
import { assertReleaseRuns } from "../../scripts/release-gates.mjs";

const commit = "a".repeat(40);
const runs = ["ci", "codeql"].map((name) => ({
  path: `.github/workflows/${name}.yml`,
  head_sha: commit,
  event: "push",
  head_branch: "main",
  status: "completed",
  conclusion: "success",
  run_number: 1,
  run_attempt: 1,
}));
describe("immutable release gates", () => {
  it("accepts both successful exact-commit push gates", () => {
    expect(() => assertReleaseRuns(commit, runs)).not.toThrow();
  });
  it("rejects abbreviated commits and missing gates", () => {
    expect(() => assertReleaseRuns("aaaa", runs)).toThrow();
    expect(() => assertReleaseRuns(commit, runs.slice(0, 1))).toThrow();
  });
  it("rejects unrelated commits and pull request gates", () => {
    expect(() =>
      assertReleaseRuns(
        commit,
        runs.map((run) => ({ ...run, head_sha: "b".repeat(40) })),
      ),
    ).toThrow();
    expect(() =>
      assertReleaseRuns(
        commit,
        runs.map((run) => ({ ...run, event: "pull_request" })),
      ),
    ).toThrow();
  });
  it("rejects a newer failed or unfinished rerun", () => {
    for (const status of ["completed", "in_progress"])
      expect(() =>
        assertReleaseRuns(commit, [
          ...runs,
          { ...runs[0]!, status, conclusion: "failure", run_attempt: 2 },
        ]),
      ).toThrow();
  });
});
