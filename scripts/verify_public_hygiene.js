const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const TEMPLATE_ROOT = path.join(REPO_ROOT, "assets", "template");
const ROOT_README = path.join(REPO_ROOT, "README.md");

const FORBIDDEN_TEXT = [
  ["sidekick", ".", "idv", ".", "tw"].join(""),
  ["C:", "\\", "Users", "\\", "USER"].join(""),
  ["D:", "\\", "CODEX"].join(""),
  ["Codex", "_", "JAR", "VIS"].join("")
];

const EXCLUDED_DIRS = new Set([".git", ".github", "node_modules"]);
const FORBIDDEN_TEMPLATE_DIRS = new Set(["data", "logs", "backups", "node_modules"]);
const FORBIDDEN_TEMPLATE_EXTENSIONS = new Set([".sqlite", ".db"]);
const REQUIRED_ROOT_FILES = [
  "SECURITY.md",
  "PRIVACY.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SUPPORT.md"
];
const REQUIRED_DOC_FILES = [
  "docs/developer-quickstart.md",
  "docs/live-smoke-test.md",
  "docs/demo-walkthrough.md",
  "docs/customization-guide.md",
  "docs/release-checklist.md",
  "docs/releases/v0.1.0-alpha.md"
];
const REQUIRED_GITHUB_FILES = [
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/ISSUE_TEMPLATE/question.yml",
  ".github/pull_request_template.md",
  ".github/workflows/ci.yml"
];
const REQUIRED_TEMPLATE_FILES = [".gitignore", ".env.example"];
const README_LINKS = [
  "docs/developer-quickstart.md",
  "docs/releases/v0.1.0-alpha.md",
  "docs/live-smoke-test.md",
  "docs/demo-walkthrough.md",
  "docs/customization-guide.md",
  "docs/release-checklist.md"
];

const UNSAFE_WORKFLOW_PATTERNS = [
  { type: "deployment_command", pattern: /\b(deploy|vercel|netlify|render|cloudflare|wrangler)\b/i },
  { type: "release_command", pattern: /\b(gh\s+release|npm\s+publish)\b/i },
  { type: "tag_command", pattern: /\bgit\s+tag\b/i },
  { type: "push_command", pattern: /\bgit\s+push\b|\bdocker\s+push\b/i },
  { type: "live_line_command", pattern: /\b(live\s+line|line\s+smoke|test:lmstudio-live)\b/i },
  { type: "prod_readiness_blocking_command", pattern: /prod:readiness/i },
  { type: "env_required_command", pattern: /\.env|PUBLIC_WEBHOOK_BASE_URL|LINE_CHANNEL_SECRET|LINE_CHANNEL_ACCESS_TOKEN/i }
];

const SENSITIVE_PATTERNS = [
  {
    type: "local_absolute_path",
    pattern: /(?:^|[^A-Za-z])(?:[A-Z]:\\Users\\|[A-Z]:\\[^ \t\r\n"'<>|]+\\)/g
  },
  {
    type: "personal_tunnel_url",
    pattern: /https?:\/\/[A-Za-z0-9.-]*(?:ngrok-free\.app|ngrok\.io|trycloudflare\.com|loca\.lt|localtunnel\.me)\b/gi
  },
  {
    type: "line_access_token_literal",
    pattern: /(?:Bearer\s+|LINE_CHANNEL_ACCESS_TOKEN\s*=\s*)[A-Za-z0-9+/=_-]{40,}/g
  },
  {
    type: "line_channel_secret_literal",
    pattern: /(?:LINE_CHANNEL_SECRET\s*=\s*|channel[_-]?secret\s*[:=]\s*)[A-Za-z0-9]{20,}/gi
  },
  {
    type: "reply_token_literal",
    pattern: /replyToken\s*[:=]\s*["'][A-Za-z0-9+/=_-]{20,}["']/g
  },
  {
    type: "generic_api_key_literal",
    pattern: /(?:SEARCH_API_KEY|API_KEY|api[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_-]{24,}/gi
  }
];

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

function relative(filePath) {
  return path.relative(REPO_ROOT, filePath);
}

function addFinding(findings, item) {
  findings.push(item);
}

function checkRequiredFiles(findings) {
  for (const rel of REQUIRED_ROOT_FILES) {
    if (!fs.existsSync(path.join(REPO_ROOT, rel))) {
      addFinding(findings, {
        type: "missing_required_public_file",
        file: rel
      });
    }
  }

  for (const rel of REQUIRED_DOC_FILES) {
    if (!fs.existsSync(path.join(REPO_ROOT, rel))) {
      addFinding(findings, {
        type: "missing_required_developer_doc",
        file: rel
      });
    }
  }

  for (const rel of REQUIRED_GITHUB_FILES) {
    if (!fs.existsSync(path.join(REPO_ROOT, rel))) {
      addFinding(findings, {
        type: "missing_required_github_file",
        file: rel
      });
    }
  }

  for (const rel of REQUIRED_TEMPLATE_FILES) {
    if (!fs.existsSync(path.join(TEMPLATE_ROOT, rel))) {
      addFinding(findings, {
        type: "missing_required_template_file",
        file: path.join("assets", "template", rel)
      });
    }
  }
}

function checkReadmeReleaseStatements(findings) {
  if (!fs.existsSync(ROOT_README)) {
    addFinding(findings, {
      type: "missing_required_public_file",
      file: "README.md"
    });
    return;
  }

  const text = fs.readFileSync(ROOT_README, "utf8").toLowerCase();
  const unofficialOk =
    text.includes("non-official") ||
    text.includes("not affiliated") ||
    text.includes("not an official");
  const freeScopeOk =
    text.includes("free does not mean") ||
    text.includes("not mean") && text.includes("free or unlimited") ||
    text.includes("costs, limits, and terms");
  const remoteLlmOk =
    text.includes("remote llm") &&
    (text.includes("unsafe") || text.includes("manual approval required"));
  const alphaOk =
    text.includes("v0.1.0-alpha") &&
    text.includes("not production ready") &&
    (text.includes("not stable") || text.includes("stable"));
  const developerQuickstartOk = README_LINKS.every((link) => text.includes(link.toLowerCase()));

  if (!unofficialOk) {
    addFinding(findings, {
      type: "missing_readme_unofficial_statement",
      file: "README.md"
    });
  }
  if (!freeScopeOk) {
    addFinding(findings, {
      type: "missing_readme_free_scope_statement",
      file: "README.md"
    });
  }
  if (!remoteLlmOk) {
    addFinding(findings, {
      type: "missing_readme_remote_llm_warning",
      file: "README.md"
    });
  }
  if (!alphaOk) {
    addFinding(findings, {
      type: "missing_readme_alpha_not_production_ready_statement",
      file: "README.md"
    });
  }
  if (!developerQuickstartOk) {
    addFinding(findings, {
      type: "missing_readme_developer_alpha_links",
      file: "README.md"
    });
  }
}

function scanSensitivePatterns(findings, filePath, content) {
  const lines = content.split(/\r?\n/);
  for (const rule of SENSITIVE_PATTERNS) {
    for (const [index, line] of lines.entries()) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(line)) {
        addFinding(findings, {
          type: rule.type,
          file: relative(filePath),
          line: index + 1
        });
      }
    }
  }
}

function readTextIfExists(rel) {
  const filePath = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function checkWorkflowSafety(findings) {
  const workflowsDir = path.join(REPO_ROOT, ".github", "workflows");
  if (!fs.existsSync(workflowsDir)) {
    addFinding(findings, {
      type: "missing_github_workflows_directory",
      path: ".github/workflows"
    });
    return;
  }

  for (const entry of fs.readdirSync(workflowsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(ya?ml)$/i.test(entry.name)) {
      continue;
    }

    const rel = path.join(".github", "workflows", entry.name);
    const text = readTextIfExists(rel);
    const lines = text.split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
      const trimmed = line.trim();
      const isRunLine = /^run:\s*/.test(trimmed) || /^\s{8,}\S/.test(line);
      if (!isRunLine) {
        continue;
      }

      for (const rule of UNSAFE_WORKFLOW_PATTERNS) {
        if (rule.pattern.test(trimmed)) {
          addFinding(findings, {
            type: rule.type,
            file: rel,
            line: index + 1
          });
        }
      }
    }
  }

  const ciText = readTextIfExists(".github/workflows/ci.yml");
  for (const requiredCommand of [
    "node scripts/verify_public_hygiene.js",
    "node scripts/verify_linebot_project.js assets/template",
    "npm run check --prefix assets/template"
  ]) {
    if (!ciText.includes(requiredCommand)) {
      addFinding(findings, {
        type: "ci_missing_required_non_live_command",
        file: ".github/workflows/ci.yml",
        command: requiredCommand
      });
    }
  }
}

function main() {
  const findings = [];

  checkRequiredFiles(findings);
  checkReadmeReleaseStatements(findings);
  checkWorkflowSafety(findings);

  walk(REPO_ROOT, (filePath) => {
    if (!isTextReadable(filePath)) {
      return;
    }
    const content = fs.readFileSync(filePath, "utf8");
    for (const value of FORBIDDEN_TEXT) {
      if (content.includes(value)) {
        findings.push({
          type: "forbidden_text",
          file: relative(filePath),
          value_type: "repository_specific_forbidden_text"
        });
      }
    }
    scanSensitivePatterns(findings, filePath, content);
  });

  walkTemplateEntries(TEMPLATE_ROOT, (filePath, entry) => {
    if (entry.isDirectory() && FORBIDDEN_TEMPLATE_DIRS.has(entry.name)) {
      findings.push({
        type: "forbidden_runtime_directory",
        path: relative(filePath)
      });
    }
    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (entry.name === ".env" || FORBIDDEN_TEMPLATE_EXTENSIONS.has(ext)) {
        findings.push({
          type: "forbidden_runtime_file",
          path: relative(filePath)
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
