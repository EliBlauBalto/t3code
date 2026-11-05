#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

function responsesFor(home, now) {
  const account = path.basename(path.dirname(home));
  return {
    initialize: {
      userAgent: "codex-fixture/1.0.0",
      codexHome: home,
      platformFamily: "unix",
      platformOs: "linux",
    },
    "account/read": {
      account: { type: "chatgpt", email: `${account}@example.invalid`, planType: "pro" },
      requiresOpenaiAuth: false,
    },
    "skills/list": { data: [] },
    "model/list": { data: [] },
    "account/rateLimits/read": {
      accountId: account,
      rateLimits: {
        planType: "pro",
        primary: {
          usedPercent: 64,
          resetsAt: Math.floor(now / 1000) + 5400,
          windowDurationMins: 300,
        },
        secondary: {
          usedPercent: 21,
          resetsAt: Math.floor(now / 1000) + 86400,
          windowDurationMins: 10080,
        },
      },
    },
  };
}

module.exports = { responsesFor };

if (require.main === module) {
  if (process.argv[2] === "--version") {
    console.log("codex-fixture 1.0.0");
  } else if (process.argv[2] !== "app-server") {
    process.exitCode = 64;
  } else {
    const home = process.env.CODEX_HOME;
    if (!home) throw new Error("The fixture requires its disposable provider home");
    const responses = responsesFor(home, Date.now());
    fs.writeFileSync(
      path.join(home, "models_cache.json"),
      JSON.stringify({ fetched_at: new Date().toISOString() }),
    );
    readline.createInterface({ input: process.stdin }).on("line", (line) => {
      const request = JSON.parse(line);
      if (request.id === undefined) return;
      const result = responses[request.method];
      process.stdout.write(
        JSON.stringify(
          result === undefined
            ? {
                id: request.id,
                error: { code: -32601, message: "Fixture supports provider probes only" },
              }
            : { id: request.id, result },
        ) + "\n",
      );
    });
  }
}
