#!/usr/bin/env node
/**
 * Small helper so CI builds (and local devs) don't need to remember to export
 * CLOUDFLARE_ACCOUNT_ID before calling Wrangler. If the environment already
 * provides it we leave it untouched; otherwise we fall back to the Pages
 * account this project lives under.
 */
const { spawn, spawnSync } = require("child_process");

const DEFAULT_ACCOUNT_ID = "109120572c26f26b602e7db3339a6591";
const PROJECT_NAME = "warning-forever";

const env = { ...process.env };
if (!env.CLOUDFLARE_ACCOUNT_ID) {
  env.CLOUDFLARE_ACCOUNT_ID = DEFAULT_ACCOUNT_ID;
}

const isPagesCI = Boolean(env.CF_PAGES || env.CF_PAGES_BRANCH || env.CF_PAGES_PROJECT_NAME);
const shouldBuild = !isPagesCI && env.WF_SKIP_DEPLOY_BUILD !== "1";

if (shouldBuild) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["run", "build"], {
    stdio: "inherit",
    env,
  });
  if (result.status !== 0) {
    process.exit(typeof result.status === "number" ? result.status : 1);
  }
}

const runner = process.platform === "win32" ? "npx.cmd" : "npx";
const args = ["wrangler", "pages", "deploy", "dist", "--project-name", PROJECT_NAME];

const child = spawn(runner, args, {
  stdio: "inherit",
  env,
});

child.on("exit", (code) => {
  process.exit(code === undefined || code === null ? 0 : code);
});

child.on("error", (error) => {
  console.error("Failed to launch Wrangler:", error);
  process.exit(1);
});
