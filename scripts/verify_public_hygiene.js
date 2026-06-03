const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const TEMPLATE_ROOT = path.join(REPO_ROOT, "assets", "template");

const FORBIDDEN_TEXT = [
  ["sidekick", ".", "idv", ".", "tw"].join(""),
  ["C:", "\\", "Users", "\\", "USER"].join(""),
  ["D:", "\\", "CODEX"].join(""),
  ["Codex", "_", "JAR", "VIS"].join("")
];

const EXCLUDED_DIRS = new Set([".git", ".github", "node_modules"]);
const FORBIDDEN_TEMPLATE_DIRS = new Set(["data", "logs", "backups", "node_modules"]);
const FORBIDDEN_TEMPLATE_EXTENSIONS = new Set([".sqlite", ".db"]);

function walk(root, visit) {
  if (!fs.existsSync(root)) {
    return;
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        walk(fullPath, visit);
      }
      continue;
    }
    visit(fullPath);
  }
}

function walkTemplateEntries(root, visit) {
  if (!fs.existsSync(root)) {
    return;
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    visit(fullPath, entry);
    if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name)) {
      walkTemplateEntries(fullPath, visit);
    }
  }
}

function isTextReadable(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ![".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip"].includes(ext);
}

function main() {
  const findings = [];

  walk(REPO_ROOT, (filePath) => {
    if (!isTextReadable(filePath)) {
      return;
    }
    const content = fs.readFileSync(filePath, "utf8");
    for (const value of FORBIDDEN_TEXT) {
      if (content.includes(value)) {
        findings.push({
          type: "forbidden_text",
          file: path.relative(REPO_ROOT, filePath),
          value
        });
      }
    }
  });

  walkTemplateEntries(TEMPLATE_ROOT, (filePath, entry) => {
    if (entry.isDirectory() && FORBIDDEN_TEMPLATE_DIRS.has(entry.name)) {
      findings.push({
        type: "forbidden_runtime_directory",
        path: path.relative(REPO_ROOT, filePath)
      });
    }
    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (entry.name === ".env" || FORBIDDEN_TEMPLATE_EXTENSIONS.has(ext)) {
        findings.push({
          type: "forbidden_runtime_file",
          path: path.relative(REPO_ROOT, filePath)
        });
      }
    }
  });

  const result = {
    status: findings.length === 0 ? "PASS" : "FAIL",
    checked_root: REPO_ROOT,
    findings
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = findings.length === 0 ? 0 : 2;
}

main();
