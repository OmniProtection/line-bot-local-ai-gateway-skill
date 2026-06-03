const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const {
  PRODUCTIONIZATION_ROOT,
  evidenceStatus,
  scanEvidenceSecrets
} = require("./production-evidence-contract");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const TASK_BACKLOG = path.join(PRODUCTIONIZATION_ROOT, "task-backlog.md");
const APPROVAL_MATRIX = path.join(PRODUCTIONIZATION_ROOT, "approval-matrix.md");
const APPROVAL_EXECUTION_PLAN = path.join(PRODUCTIONIZATION_ROOT, "approval-execution-plan.md");
const GO_LIVE_GATE = path.join(PRODUCTIONIZATION_ROOT, "go-live-gate.md");
const REPORT_PATH = path.join(PRODUCTIONIZATION_ROOT, "readiness-report.md");

function readTaskBacklog() {
  if (!fs.existsSync(TASK_BACKLOG)) {
    return [
      {
        id: "LINEBOT-P0-DOCS",
        phase: "0",
        task: "Productionization docs pack is missing.",
        status: "BLOCKED",
        acceptance: "Template docs exist under docs/maintenance/GO-LINEBOT-PRODUCTIONIZATION-001.",
        evidence: "task-backlog.md"
      }
    ];
  }

  const markdown = fs.readFileSync(TASK_BACKLOG, "utf8");
  const tasks = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("| LINEBOT-")) {
      continue;
    }
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 5) {
      continue;
    }
    const phase = cells[0].match(/^LINEBOT-P(\d+)-/)?.[1] || "?";
    tasks.push({
      id: cells[0],
      phase,
      task: cells[1],
      status: cells[2],
      acceptance: cells[3],
      evidence: cells[4]
    });
  }
  return tasks;
}

function runReadinessAudit() {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(PROJECT_ROOT, "scripts", "production-readiness-audit.js")],
      { cwd: PROJECT_ROOT, windowsHide: true },
      (error, stdout, stderr) => {
        let parsed = null;
        try {
          parsed = stdout ? JSON.parse(stdout) : null;
        } catch {
          parsed = null;
        }
        resolve({
          ok: Boolean(parsed),
          code: error?.code || 0,
          parsed,
          stderr: String(stderr || "")
        });
      }
    );
  });
}

function summarize(tasks) {
  return tasks.reduce(
    (summary, task) => {
      summary.total += 1;
      summary.by_status[task.status] = (summary.by_status[task.status] || 0) + 1;
      return summary;
    },
    { total: 0, by_status: {} }
  );
}

function phaseName(phase) {
  return (
    {
      "0": "Baseline",
      "1": "Local Runtime Supervision",
      "2": "Public Ingress And LINE Webhook",
      "3": "LM Studio Readiness",
      "4": "Observability",
      "5": "Data Protection",
      "6": "Release Management",
      "7": "Incident Response",
      "8": "Final Go-Live"
    }[phase] || `Phase ${phase}`
  );
}

function markdownEscape(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderReport(tasks, audit) {
  const summary = summarize(tasks);
  const evidence = evidenceStatus();
  const secretAudit = scanEvidenceSecrets();
  const openTasks = tasks.filter((task) => task.status !== "PASS");
  const byPhase = new Map();
  for (const task of tasks) {
    if (!byPhase.has(task.phase)) {
      byPhase.set(task.phase, []);
    }
    byPhase.get(task.phase).push(task);
  }

  const lines = [
    "# LINE Bot Production Readiness Report",
    "",
    "## Status",
    "",
    `Status: ${audit?.status || "FAIL"}`,
    "",
    "This report records the current production readiness evidence. It does not approve production operations, create scheduled tasks, change public routes, modify credentials, or mutate LINE Console settings.",
    "",
    "## Summary",
    "",
    `- Checked at: ${audit?.checked_at || new Date().toISOString()}`,
    `- Production ready: ${audit?.production_ready === true ? "true" : "false"}`,
    `- Required files OK: ${audit?.required_files_ok === true ? "true" : "false"}`,
    `- Core automation OK: ${audit?.core_automation_ok === true ? "true" : "false"}`,
    `- Total tasks: ${summary.total}`,
    `- PASS: ${summary.by_status.PASS || 0}`,
    `- CEO_DECISION_REQUIRED: ${summary.by_status.CEO_DECISION_REQUIRED || 0}`,
    `- BLOCKED: ${summary.by_status.BLOCKED || 0}`,
    `- FAIL: ${summary.by_status.FAIL || 0}`,
    "",
    "## Phase Evidence",
    ""
  ];

  for (const [phase, phaseTasks] of [...byPhase.entries()].sort((left, right) => Number(left[0]) - Number(right[0]))) {
    lines.push(`### Phase ${phase} - ${phaseName(phase)}`);
    lines.push("");
    lines.push("| Task ID | Status | Evidence |");
    lines.push("| --- | --- | --- |");
    for (const task of phaseTasks) {
      lines.push(`| ${task.id} | ${task.status} | ${markdownEscape(task.evidence)} |`);
    }
    lines.push("");
  }

  lines.push("## Open Items");
  lines.push("");
  lines.push("| Task ID | Status | Required Evidence |");
  lines.push("| --- | --- | --- |");
  for (const task of openTasks) {
    lines.push(`| ${task.id} | ${task.status} | ${markdownEscape(task.evidence)} |`);
  }
  if (openTasks.length === 0) {
    lines.push("| none | PASS | all task evidence is present |");
  }
  lines.push("");
  lines.push("## Approval Gates");
  lines.push("");
  lines.push(`See \`${path.relative(PRODUCTIONIZATION_ROOT, APPROVAL_MATRIX)}\` and \`${path.relative(PRODUCTIONIZATION_ROOT, APPROVAL_EXECUTION_PLAN)}\`.`);
  lines.push("");
  lines.push("## Go-Live Gate");
  lines.push("");
  lines.push(`See \`${path.relative(PRODUCTIONIZATION_ROOT, GO_LIVE_GATE)}\` and run \`npm run prod:go-live\`.`);
  lines.push("");
  lines.push("## Evidence Records");
  lines.push("");
  lines.push(`- Required: ${evidence.length}`);
  lines.push(`- PASS: ${evidence.filter((item) => item.status === "PASS").length}`);
  lines.push(`- BLOCKED: ${evidence.filter((item) => item.status === "BLOCKED").length}`);
  lines.push(`- FAIL: ${evidence.filter((item) => item.status === "FAIL").length}`);
  lines.push(`- Secret audit: ${secretAudit.status}`);
  lines.push(`- Secret findings: ${secretAudit.findings_count}`);
  lines.push("");
  lines.push("## Automated Check Snapshot");
  lines.push("");
  lines.push("```json");
  lines.push(
    JSON.stringify(
      {
        status: audit?.status || "FAIL",
        production_ready: audit?.production_ready === true,
        required_files_ok: audit?.required_files_ok === true,
        core_automation_ok: audit?.core_automation_ok === true,
        task_summary: audit?.task_summary || null
      },
      null,
      2
    )
  );
  lines.push("```");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const tasks = readTaskBacklog();
  const auditResult = await runReadinessAudit();
  const report = renderReport(tasks, auditResult.parsed);
  fs.writeFileSync(REPORT_PATH, report, "utf8");
  console.log(
    JSON.stringify(
      {
        status: auditResult.ok ? "PASS" : "FAIL",
        readiness_status: auditResult.parsed?.status || "FAIL",
        report_path: REPORT_PATH,
        readiness_exit_code: auditResult.code
      },
      null,
      2
    )
  );
  process.exitCode = auditResult.ok ? 0 : 2;
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "FAIL",
        error_class: error?.name || "Error",
        error_message: error?.message || String(error)
      },
      null,
      2
    )
  );
  process.exitCode = 2;
});
