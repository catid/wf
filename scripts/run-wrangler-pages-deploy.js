#!/usr/bin/env node
/**
 * Small helper so CI builds (and local devs) don't need to remember to export
 * CLOUDFLARE_ACCOUNT_ID before calling Wrangler. If the environment already
 * provides it we leave it untouched; otherwise we fall back to the Pages
 * account this project lives under.
 */
const { spawn, spawnSync } = require("child_process");
const { existsSync, readdirSync } = require("fs");
const path = require("path");

const DEFAULT_ACCOUNT_ID = "109120572c26f26b602e7db3339a6591";
const PROJECT_NAME = "warning-forever";
const DIST_DIR = path.resolve(__dirname, "..", "dist");

const env = { ...process.env };
if (!env.CLOUDFLARE_ACCOUNT_ID) {
  env.CLOUDFLARE_ACCOUNT_ID = DEFAULT_ACCOUNT_ID;
}

const shouldUseWrangler =
  typeof env.WF_USE_WRANGLER === "string" &&
  ["1", "true", "yes"].includes(env.WF_USE_WRANGLER.toLowerCase());
const shouldBuild = shouldUseWrangler && env.WF_SKIP_DEPLOY_BUILD !== "1";

function ensureDistExists() {
  if (!existsSync(DIST_DIR)) {
    console.error("wf deploy: dist/ is missing. Run `npm run build` first.");
    process.exit(1);
  }
  const entries = readdirSync(DIST_DIR);
  if (entries.length === 0) {
    console.error("wf deploy: dist/ is empty. Run `npm run build` first.");
    process.exit(1);
  }
}

if (!shouldUseWrangler) {
  ensureDistExists();
  console.log(
    "wf deploy: dist/ verified. Cloudflare Pages will upload these files automatically; no Wrangler invocation needed."
  );
  process.exit(0);
}

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

ensureDistExists();

if (!env.CLOUDFLARE_API_TOKEN && !env.CLOUDFLARE_API_KEY) {
  console.error(
    "No Cloudflare credentials detected. Set CLOUDFLARE_API_TOKEN (preferred) or CLOUDFLARE_API_KEY/CLOUDFLARE_EMAIL to run Wrangler locally."
  );
  process.exit(1);
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
