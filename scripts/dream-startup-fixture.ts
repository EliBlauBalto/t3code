// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Owns disposable fixture servers and the native test runner.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeURL from "node:url";

import { startShowcaseEnvironments, issuePairingCredential } from "./mobile-showcase.ts";
import { SHOWCASE_ENVIRONMENTS, SHOWCASE_THREADS } from "./mobile-showcase-environment.ts";

const owned: NodeChildProcess.ChildProcess[] = [];
const fixtureSockets = new Set<NodeNet.Socket>();
const fixtureListeners: Array<NodeNet.Server | NodeHttp.Server> = [];
const waitForExit = (child: NodeChildProcess.ChildProcess) =>
  new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
const waitForImportedThread = (
  database: NodeSqlite.DatabaseSync,
  directory: string,
  threadId: string,
) =>
  new Promise<void>((resolve, reject) => {
    const watcher = NodeFS.watch(directory, { signal: AbortSignal.timeout(30_000) }, check);
    watcher.once("error", reject);
    watcher.once("close", () =>
      reject(new Error(`Disposable thread ${threadId} import incomplete`)),
    );
    function check() {
      try {
        const ready = database
          .prepare(`
          SELECT 1 AS ready FROM orchestration_v2_projection_threads AS thread
          WHERE thread_id = ? AND archived_at IS NULL AND deleted_at IS NULL
            AND provider_instance_id IS NOT NULL AND payload_json IS NOT NULL
            AND EXISTS (SELECT 1 FROM orchestration_v2_projection_messages AS message
              WHERE message.thread_id = thread.thread_id AND message.role = 'user')
        `)
          .get(threadId);
        if (ready?.ready === 1) {
          resolve();
          watcher.close();
        }
      } catch (error) {
        reject(error);
        watcher.close();
      }
    }
    check();
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
  const statusFixture = process.env.T3_DREAM_STATUS_FIXTURE === "1";
  const failedFixture = process.env.T3_DREAM_FAILED_FIXTURE === "1" || statusFixture;
  if (failedFixture) {
    const fixtureThreadId = SHOWCASE_THREADS[0].id;
    // This projection belongs only to this disposable fixture; no provider turn is executed.
    using database = new NodeSqlite.DatabaseSync(
      NodePath.join(environments[0]!.baseDir, "userdata", "statev2.sqlite"),
    );
    database.exec("PRAGMA busy_timeout = 5000");
    await waitForImportedThread(
      database,
      NodePath.join(environments[0]!.baseDir, "userdata"),
      fixtureThreadId,
    );
    const thread = database
      .prepare(`
      SELECT provider_instance_id, payload_json FROM orchestration_v2_projection_threads
      WHERE thread_id = ? AND archived_at IS NULL AND deleted_at IS NULL
    `)
      .get(fixtureThreadId);
    const message = database
      .prepare(`
      SELECT message_id FROM orchestration_v2_projection_messages
      WHERE thread_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 1
    `)
      .get(fixtureThreadId);
    if (
      !thread ||
      typeof thread.payload_json !== "string" ||
      !message ||
      typeof message.message_id !== "string" ||
      typeof thread.provider_instance_id !== "string"
    ) {
      throw new Error("Disposable Dream fixture is missing its imported V2 thread or message");
    }
    const ordinal = database
      .prepare(`
      SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal FROM orchestration_v2_projection_runs
      WHERE thread_id = ?
    `)
      .get(fixtureThreadId)?.ordinal;
    if (typeof ordinal !== "number") throw new Error("Dream fixture run ordinal missing");
    const payload = JSON.parse(thread.payload_json) as { modelSelection: unknown };
    const now = new Date().toISOString();
    const run = {
      id: "dream-fixture-failed-run",
      threadId: fixtureThreadId,
      ordinal,
      providerInstanceId: thread.provider_instance_id,
      modelSelection: payload.modelSelection,
      providerThreadId: null,
      userMessageId: message.message_id,
      rootNodeId: null,
      activeAttemptId: null,
      status: "failed",
      requestedAt: now,
      startedAt: now,
      completedAt: now,
      checkpointId: null,
      contextHandoffId: null,
    };
    database
      .prepare(`
      INSERT INTO orchestration_v2_projection_runs
      (run_id, thread_id, ordinal, provider, provider_instance_id, provider_thread_id,
       status, requested_at, completed_at, payload_json)
      VALUES (?, ?, ?, ?, ?, NULL, 'failed', ?, ?, ?)
    `)
      .run(
        run.id,
        run.threadId,
        ordinal,
        run.providerInstanceId,
        run.providerInstanceId,
        now,
        now,
        JSON.stringify(run),
      );
    const stored = database
      .prepare(`
      SELECT run_id, thread_id, status FROM orchestration_v2_projection_runs WHERE run_id = ?
    `)
      .get(run.id);
    if (stored?.status !== "failed") throw new Error("Dream fixture failed-state seed missing");
    const output = process.argv[3];
    if (!output) throw new Error("Dream fixture evidence directory is required");
    await NodeFSP.mkdir(output, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(output, "fixture-seed.json"),
      JSON.stringify(
        {
          synthetic: true,
          providerTurnsExecuted: 0,
          expectedFailed: 1,
          stored,
        },
        null,
        2,
      ) + "\n",
    );
  }
  if (statusFixture) {
    const seeded = [];
    for (const seed of [
      { environment: 0, threadId: "pocket-command-center", kind: "limited" },
      { environment: 1, threadId: "buttery-suspense", kind: "waiting" },
    ] as const) {
      using database = new NodeSqlite.DatabaseSync(
        NodePath.join(environments[seed.environment]!.baseDir, "userdata", "statev2.sqlite"),
      );
      database.exec("PRAGMA busy_timeout = 5000");
      await waitForImportedThread(
        database,
        NodePath.join(environments[seed.environment]!.baseDir, "userdata"),
        seed.threadId,
      );
      const thread = database
        .prepare(`
        SELECT provider_instance_id, payload_json FROM orchestration_v2_projection_threads
        WHERE thread_id = ? AND archived_at IS NULL AND deleted_at IS NULL
      `)
        .get(seed.threadId);
      const message = database
        .prepare(`
        SELECT message_id FROM orchestration_v2_projection_messages
        WHERE thread_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 1
      `)
        .get(seed.threadId);
      const ordinal = database
        .prepare(`
        SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal FROM orchestration_v2_projection_runs
        WHERE thread_id = ?
      `)
        .get(seed.threadId)?.ordinal;
      if (
        !thread ||
        typeof thread.payload_json !== "string" ||
        typeof thread.provider_instance_id !== "string" ||
        !message ||
        typeof message.message_id !== "string" ||
        typeof ordinal !== "number"
      ) {
        throw new Error("Missing disposable status-fixture thread, message or ordinal");
      }
      const now = new Date().toISOString();
      const id = `dream-fixture-${seed.kind}`;
      const run = {
        id,
        threadId: seed.threadId,
        ordinal,
        providerInstanceId: thread.provider_instance_id,
        modelSelection: (JSON.parse(thread.payload_json) as { modelSelection: unknown })
          .modelSelection,
        providerThreadId: null,
        userMessageId: message.message_id,
        rootNodeId: `${id}-node`,
        activeAttemptId: null,
        status: seed.kind === "limited" ? "failed" : "running",
        requestedAt: now,
        startedAt: now,
        completedAt: seed.kind === "limited" ? now : null,
        checkpointId: null,
        contextHandoffId: null,
      };
      const item = {
        id: `${id}-item`,
        threadId: seed.threadId,
        runId: id,
        nodeId: run.rootNodeId,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 1,
        title: seed.kind === "limited" ? "Usage limit reached" : "Waiting for a thread",
        startedAt: now,
        completedAt: run.completedAt,
        updatedAt: now,
        ...(seed.kind === "limited"
          ? {
              type: "error",
              status: "failed",
              failure: {
                class: "usage_limit",
                message: "Plan limit reached.",
                code: "usageLimitExceeded",
                resetAt: "2099-01-01T00:00:00.000Z",
                retryable: null,
              },
            }
          : {
              type: "dynamic_tool",
              status: "waiting",
              toolName: "mcp__t3_code__t3_thread_wait",
              input: { threadId: "disposable-status-child" },
            }),
      };
      database
        .prepare(`
        INSERT INTO orchestration_v2_projection_runs
          (run_id, thread_id, ordinal, provider, provider_instance_id, provider_thread_id,
           status, requested_at, completed_at, payload_json)
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
      `)
        .run(
          id,
          seed.threadId,
          ordinal,
          run.providerInstanceId,
          run.providerInstanceId,
          run.status,
          now,
          run.completedAt,
          JSON.stringify(run),
        );
      database
        .prepare(`
        INSERT INTO orchestration_v2_projection_turn_items
          (turn_item_id, thread_id, run_id, node_id, provider_thread_id, provider_turn_id,
           parent_item_id, ordinal, type, status, updated_at, payload_json)
        VALUES (?, ?, ?, ?, NULL, NULL, NULL, 1, ?, ?, ?, ?)
      `)
        .run(
          item.id,
          seed.threadId,
          id,
          item.nodeId,
          item.type,
          item.status,
          now,
          JSON.stringify(item),
        );
      seeded.push({ environment: seed.environment, threadId: seed.threadId, run, item });
    }
    const output = process.argv[3];
    if (!output) throw new Error("Disposable status fixture needs an evidence directory");
    await NodeFSP.writeFile(
      NodePath.join(output, "status-fixture-seed.json"),
      JSON.stringify(
        {
          synthetic: true,
          providerTurnsExecuted: 0,
          expectedFailed: 1,
          expectedLimited: 1,
          expectedWaiting: 1,
          seeded,
        },
        null,
        2,
      ) + "\n",
    );
  }
  let secondOnline = true;
  const proxy = NodeNet.createServer((client) => {
    if (!secondOnline) {
      client.destroy();
      return;
    }
    const upstream = NodeNet.connect(environments[1]!.port, "127.0.0.1");
    for (const socket of [client, upstream]) {
      fixtureSockets.add(socket);
      socket.once("close", () => {
        fixtureSockets.delete(socket);
        client.destroy();
        upstream.destroy();
      });
      socket.on("error", () => socket.destroy());
    }
    client.pipe(upstream);
    upstream.pipe(client);
  });
  const control = NodeHttp.createServer((request, response) => {
    if (request.method !== "POST" || !["/offline", "/online"].includes(request.url ?? "")) {
      response.writeHead(404).end();
      return;
    }
    secondOnline = request.url === "/online";
    if (!secondOnline) for (const socket of fixtureSockets) socket.destroy();
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ synthetic: true, online: secondOnline }));
  });
  const ports = await Promise.all(
    [proxy, control].map(
      (listener) =>
        new Promise<number>((resolve, reject) => {
          fixtureListeners.push(listener);
          listener.once("error", reject);
          listener.listen(0, "127.0.0.1", () => {
            const address = listener.address();
            if (address === null || typeof address === "string") {
              reject(new Error("Disposable connection fixture has no TCP port"));
              return;
            }
            resolve(address.port);
          });
        }),
    ),
  );
  const fixture = await Promise.all(
    environments.map(async (environment, index) => ({
      address: `http://10.0.2.2:${index === 1 ? ports[0] : environment.port}`,
      code: await issuePairingCredential(environment.baseDir),
      expectedFailed: failedFixture && index === 0 ? 1 : 0,
      statusFixture,
      connectionControl: index === 1 ? `http://10.0.2.2:${ports[1]}` : undefined,
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
  for (const socket of fixtureSockets) socket.destroy();
  await Promise.all(
    fixtureListeners.map(
      (listener) => new Promise<void>((resolve) => listener.close(() => resolve())),
    ),
  );
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
