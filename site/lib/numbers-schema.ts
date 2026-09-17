/**
 * Payload v1 for opt-in numbers sharing, mirroring SPEC.md §7.10 exactly. Numbers and
 * allowlisted enums only, `.strict()` at every object level so an unknown key, or any free
 * string, is refused rather than silently dropped. There is no free-text field anywhere in
 * this shape: nothing here can carry a prompt, a path, a file name, a title, a commit
 * message, a repository id, a branch or a hostname.
 */
import { z } from "zod";

const semver = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;
const nodeVersion = /^v?\d+\.\d+\.\d+$/;
const installId = /^[0-9a-f]{32}$/;
const modelName = /^[a-z0-9][a-z0-9.\-:]{0,63}$/;
const fixId = /^f\d+-[a-z0-9-]{1,40}$/;

const nonNegInt = z.number().int().nonnegative();
const nonNegFiniteOrNull = z.number().finite().nonnegative().nullable();

const modelRow = z
  .object({
    model: z.string().regex(modelName),
    runs: nonNegInt,
  })
  .strict();

export const numbersPayloadV1 = z
  .object({
    v: z.literal(1),
    install_id: z.string().regex(installId),
    tool_version: z.string().regex(semver).nullable(),
    claude_code_version: z.string().regex(semver).nullable(),
    node: z.string().regex(nodeVersion),
    os: z.enum(["darwin", "linux", "win32", "other"]),
    arch: z.enum(["arm64", "x64", "other"]),
    editor: z.enum(["terminal", "vscode"]),
    scope: z.enum(["repo", "all"]),
    period_days: nonNegInt.nullable(),
    sessions: nonNegInt,
    agent_runs: nonNegInt,
    cost_usd: nonNegFiniteOrNull,
    commits: nonNegInt,
    cost_per_commit: nonNegFiniteOrNull,
    files_written: nonNegInt,
    files_alive: nonNegInt,
    runs_no_fate: nonNegInt,
    runs_died: nonNegInt,
    peak_concurrency: nonNegInt,
    max_depth: nonNegInt,
    models: z.array(modelRow).max(40),
    watch_on: z.boolean(),
    fixes_applied: z.array(z.string().regex(fixId)).max(20),
    run_ms: nonNegInt.nullable(),
  })
  .strict();

export type NumbersPayloadV1 = z.infer<typeof numbersPayloadV1>;
