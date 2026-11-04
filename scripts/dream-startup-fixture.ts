// @effect-diagnostics nodeBuiltinImport:off - Owns disposable fixture servers and the native test runner.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { startShowcaseEnvironments, issuePairingCredential } from "./mobile-showcase.ts";
import { SHOWCASE_ENVIRONMENTS } from "./mobile-showcase-environment.ts";

const owned: NodeChildProcess.ChildProcess[] = [];
const waitForExit = (child: NodeChildProcess.ChildProcess) =>
  new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "dream-fixture-"));
try {
  const environments = await startShowcaseEnvironments(
    root,
    (child) => owned.push(child),
    SHOWCASE_ENVIRONMENTS.slice(0, 2),
  );
  const fixture = await Promise.all(
    environments.map(async (environment) => ({
      address: `http://10.0.2.2:${environment.port}`,
      code: await issuePairingCredential(environment.baseDir),
    })),
  );
  const runner = NodeChildProcess.spawn(
    "bash",
    [
      NodeURL.fileURLToPath(new URL("../apps/mobile/tests/startup/run.sh", import.meta.url)),
      ...process.argv.slice(2),
    ],
    {
      stdio: "inherit",
      env: { ...process.env, T3_DREAM_FIXTURE: JSON.stringify(fixture) },
    },
  );
  const code = await waitForExit(runner);
  process.exitCode = code ?? 1;
} finally {
  await Promise.all(
    owned
      .filter((child) => child.exitCode === null && child.signalCode === null)
      .map(async (child) => {
        const stopped = waitForExit(child);
        child.kill("SIGTERM");
        await stopped;
      }),
  );
}
