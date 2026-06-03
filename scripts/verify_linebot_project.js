#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(process.argv[2] || ".");
const requiredFiles = [
  "package.json",
  ".env.example",
  "README.md",
  "src/server.js",
  "src/config.js",
  "src/lineClient.js",
  "src/lmStudioClient.js",
  "src/memoryStore.js",
  "src/webSearchCommand.js",
  "src/webSearchService.js",
  "src/webSearchPolicy.js",
  "src/webSearchSecurity.js"
];
const forbiddenPaths = [".env", "data", "logs", "backups", "node_modules"];
const findings = [];

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

for (const file of requiredFiles) {
  if (!exists(file)) findings.push({ status: "FAIL", type: "missing_required_file", file });
}

for (const rel of forbiddenPaths) {
  if (exists(rel)) findings.push({ status: "FAIL", type: "forbidden_runtime_artifact", path: rel });
}

function checkText(rel, checks) {
  if (!exists(rel)) return;
  const text = read(rel);
  for (const check of checks) {
    if (!check.pattern.test(text)) {
      findings.push({ status: "FAIL", type: "missing_pattern", file: rel, rule: check.rule });
    }
  }
}

checkText("src/server.js", [
  { rule: "health_endpoint", pattern: /app\.get\(["']\/health["']/ },
  { rule: "webhook_endpoint", pattern: /app\.post\(["']\/webhook["']/ },
  { rule: "line_middleware", pattern: /middlewareFactory\(config\)|createLineMiddleware/ },
  { rule: "memory_command_before_general_model", pattern: /parseMemoryCommand[\s\S]+handleMemoryCommand[\s\S]+parseWebSearchCommand[\s\S]+handleGeneralConversation/ },
  { rule: "group_no_mention_guard", pattern: /group_message_ignored_no_self_mention/ }
]);

checkText("src/config.js", [
  { rule: "line_secret_from_env", pattern: /LINE_CHANNEL_SECRET/ },
  { rule: "line_token_from_env", pattern: /LINE_CHANNEL_ACCESS_TOKEN/ },
  { rule: "lmstudio_provider", pattern: /lmstudio/ },
  { rule: "web_search_flags", pattern: /WEB_SEARCH_ENABLED/ }
]);

checkText("src/lineClient.js", [
  { rule: "reply_api", pattern: /replyMessage/ },
  { rule: "push_api", pattern: /pushMessage/ }
]);

checkText("src/memoryStore.js", [
  { rule: "sqlite_dependency", pattern: /better-sqlite3/ },
  { rule: "long_term_memories", pattern: /long_term_memories/ },
  { rule: "line_event_log", pattern: /line_event_log/ },
  { rule: "conversation_summaries", pattern: /conversation_summaries/ }
]);

checkText("src/webSearchCommand.js", [
  { rule: "explicit_search_prefixes", pattern: /找\|搜\|查/ }
]);

const safeEnv = exists(".env.example") ? read(".env.example") : "";
if (/LINE_CHANNEL_SECRET=\S+/.test(safeEnv) || /LINE_CHANNEL_ACCESS_TOKEN=\S+/.test(safeEnv)) {
  findings.push({ status: "FAIL", type: "env_example_contains_real_line_secret" });
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return [full];
  });
}

const files = walk(root).filter((file) => !file.includes(`${path.sep}.git${path.sep}`));
const secretPatterns = [
  { type: "line_access_token_literal", pattern: /Bearer\s+[A-Za-z0-9+/=_-]{40,}/ },
  { type: "channel_secret_literal", pattern: /channel[_-]?secret\s*[:=]\s*[A-Za-z0-9]{20,}/i }
];
for (const file of files) {
  if (/\.(sqlite|db)$/i.test(file)) findings.push({ status: "FAIL", type: "database_file_present", file });
  const text = fs.readFileSync(file, "utf8");
  for (const secret of secretPatterns) {
    if (secret.pattern.test(text)) findings.push({ status: "FAIL", type: secret.type, file });
  }
}

const status = findings.length === 0 ? "PASS" : "FAIL";
console.log(JSON.stringify({ status, root, checked_files: files.length, findings }, null, 2));
process.exit(status === "PASS" ? 0 : 1);
