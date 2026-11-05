// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Owns disposable fixture servers and the native test runner.
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
  const provider = NodePath.join(root, "codex-fixture.cjs");
  await NodeFSP.copyFile(
    NodeURL.fileURLToPath(
      new URL("../apps/mobile/tests/startup/codex-fixture.cjs", import.meta.url),
    ),
    provider,
  );
  await NodeFSP.chmod(provider, 0o755);
  for (const environment of SHOWCASE_ENVIRONMENTS.slice(0, 2)) {
    const baseDir = NodePath.join(root, "environments", environment.id);
    const stateDir = NodePath.join(baseDir, "userdata");
    const home = NodePath.join(baseDir, "codex");
    await NodeFSP.mkdir(NodePath.join(home, "sessions"), { recursive: true });
    await NodeFSP.mkdir(stateDir, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(stateDir, "settings.json"),
      JSON.stringify({
        providerInstances: {
          codex: {
            driver: "codex",
            enabled: true,
            config: {
              setupMode: "existing",
              binaryPath: provider,
              homePath: home,
            },
          },
        },
      }),
    );
    await NodeFSP.writeFile(
      NodePath.join(stateDir, "usage-model-rates.json"),
      JSON.stringify({
        fetchedAtMs: Date.now(),
        document: {
          "gpt-6-astra": { input_cost_per_token: 0.000002, output_cost_per_token: 0.000008 },
        },
      }),
    );
    const timestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await NodeFSP.writeFile(
      NodePath.join(home, "sessions", "dream-fixture.jsonl"),
      [
        { type: "session_meta", payload: { id: `dream-${environment.id}` } },
        { type: "turn_context", payload: { model: "gpt-6-astra" } },
        {
          type: "event_msg",
          timestamp,
          payload: {
            type: "token_count",
            info: {
              last_token_usage: { input_tokens: 120000, output_tokens: 30000 },
            },
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n") + "\n",
    );
  }
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
