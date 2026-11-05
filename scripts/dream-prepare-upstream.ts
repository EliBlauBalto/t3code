// @effect-diagnostics nodeBuiltinImport:off - Reconstructs a pinned source tree on a disposable CI runner.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeZlib from "node:zlib";

const base = "a21d788752695764028e6d26ba924f3963e05806";
const expectedTree = process.env.T3_DREAM_UPSTREAM_TREE ?? "";
if (!/^[a-f0-9]{40}$/.test(expectedTree)) throw new Error("Expected upstream tree is required");
const directory = NodePath.resolve("../dream-upstream-candidate");
const patchPath = NodePath.resolve("../dream-upstream.patch");
const patch = NodeZlib.gunzipSync(Buffer.from(process.env.T3_DREAM_UPSTREAM_PATCH ?? "", "base64"));
NodeFS.writeFileSync(patchPath, patch);
const git = (args: string[], cwd = process.cwd()) =>
  NodeChildProcess.execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
git(["fetch", "--depth=1", "--no-tags", "https://github.com/pingdotgg/t3code.git", base]);
git(["worktree", "add", "--detach", directory, base]);
git(["apply", "--index", patchPath], directory);
const actualTree = git(["write-tree"], directory);
if (actualTree !== expectedTree) throw new Error(`Source tree mismatch: ${actualTree}`);
const files = git(["diff", "--cached", "--name-only", "-z"], directory).split("\0").filter(Boolean);
NodeFS.writeFileSync(
  NodePath.resolve("../dream-upstream-source.json"),
  JSON.stringify(
    {
      base,
      expectedTree,
      actualTree,
      workflowCommit: process.env.GITHUB_SHA,
      patchSha256: NodeCrypto.createHash("sha256").update(patch).digest("hex"),
      files: files.map((file) => ({
        path: file,
        sha256: NodeCrypto.createHash("sha256")
          .update(NodeFS.readFileSync(NodePath.join(directory, file)))
          .digest("hex"),
      })),
    },
    null,
    2,
  ) + "\n",
);
process.stdout.write(
  `Verified upstream source tree ${actualTree} (${files.length} changed files)\n`,
);
