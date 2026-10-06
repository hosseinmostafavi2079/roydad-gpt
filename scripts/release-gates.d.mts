export function assertReleaseRuns(
  commit: string,
  runs: Array<{
    path: string;
    head_sha: string;
    event: string;
    head_branch: string;
    status: string;
    conclusion: string;
    run_number: number;
    run_attempt: number;
  }>,
): void;
