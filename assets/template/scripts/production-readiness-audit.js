const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { scanEvidenceSecrets } = require("./production-evidence-contract");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const JARVIS_ROOT = path.resolve(PROJECT_ROOT, "..");
const PRODUCTIONIZATION_ROOT = path.join(
  JARVIS_ROOT,
  "docs",
  "maintenance",
  "GO-LINEBOT-PRODUCTIONIZATION-001"
);
const TASK_BACKLOG = path.join(PRODUCTIONIZATION_ROOT, "task-backlog.md");

function execNodeScript(script, args = []) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(PROJECT_ROOT, "scripts", script), ...args],
      { cwd: PROJECT_ROOT, windowsHide: true },
      (error, stdout, stderr) => {
        let parsed = null;
        try {
          parsed = stdout ? JSON.parse(stdout) : null;
        } catch {
          parsed = null;
        }
        resolve({
          ok: !error,
          code: error?.code || 0,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
          parsed
        });
      }
    );
  });
}

function parseTaskBacklog() {
  if (!fs.existsSync(TASK_BACKLOG)) {
    return [
      {
        id: "LINEBOT-RUNTIME-EVIDENCE",
        task: "Real runtime, public webhook, LINE smoke, backup/restore, monitoring, and go-live approval evidence are not recorded in this fresh template.",
        status: "BLOCKED",
        acceptance_criteria: "Operator runs approved live checks in a private environment and records sanitized evidence.",
        evidence_required: "runtime/live evidence"
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
    tasks.push({
      id: cells[0],
      task: cells[1],
      status: cells[2],
      acceptance_criteria: cells[3],
      evidence_required: cells[4]
    });
  }
  return tasks;
}

function summarizeTasks(tasks) {
  return tasks.reduce(
    (summary, task) => {
      summary.total += 1;
      summary.by_status[task.status] = (summary.by_status[task.status] || 0) + 1;
      if (task.status !== "PASS") {
        summary.open_tasks.push(task);
      }
      return summary;
    },
    { total: 0, by_status: {}, open_tasks: [] }
  );
}

function requiredFilesStatus() {
  const files = [
    "ticket.md",
    "productionization-phases.md",
    "task-backlog.md",
    "task-status.md",
    "approval-matrix.md",
    "approval-queue.md",
    "operational-decision-record.md",
    "approval-execution-plan.md",
    "go-live-gate.md",
    path.join("evidence-records", "README.md"),
    path.join("evidence-records", "gate-a-runtime-task.json"),
    path.join("evidence-records", "gate-b-public-webhook.json"),
    path.join("evidence-records", "gate-b-line-console.json"),
    path.join("evidence-records", "line-manual-smoke.json"),
    path.join("evidence-records", "gate-d-data-protection.json"),
    path.join("evidence-records", "gate-e-monitoring.json"),
    path.join("evidence-records", "gate-f-g-policy.json"),
    path.join("evidence-records", "gate-h-go-live-approval.json"),
    "evidence-baseline.md",
    "readiness-report.md",
    "release-checklist.md",
    "incident-runbook.md"
  ];
  return files.map((file) => {
    const filePath = path.join(PRODUCTIONIZATION_ROOT, file);
    return {
      file,
      exists: fs.existsSync(filePath),
      size_bytes: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0
    };
  });
}

async function main() {
  const tasks = parseTaskBacklog();
  const taskSummary = summarizeTasks(tasks);
  const [runtimeStatus, localHealth, backupDryRun, restoreDrillDryRun, runtimeTaskDryRun, healthTaskDryRun] =
    await Promise.all([
      execNodeScript("manage-runtime.js", ["--action=status"]),
      execNodeScript("production-health-check.js", ["--skip-public"]),
      execNodeScript("backup-sqlite-memory.js", ["--dry-run"]),
      execNodeScript("restore-sqlite-memory-drill.js"),
      execNodeScript("register-production-scheduled-task.js", ["--task=runtime"]),
      execNodeScript("register-production-scheduled-task.js", ["--task=health"])
    ]);
  const evidenceSecretAudit = scanEvidenceSecrets();

  const automatedChecks = {
    required_files: requiredFilesStatus(),
    runtime_status: runtimeStatus.parsed,
    local_health: localHealth.parsed,
    backup_dry_run: backupDryRun.parsed,
    restore_drill_dry_run: restoreDrillDryRun.parsed,
    runtime_task_dry_run: runtimeTaskDryRun.parsed,
    health_task_dry_run: healthTaskDryRun.parsed,
    evidence_secret_audit: evidenceSecretAudit
  };

  const requiredFilesOk = automatedChecks.required_files.every((file) => file.exists && file.size_bytes > 0);
  const coreAutomationOk = Boolean(
    runtimeStatus.parsed?.status === "PASS" &&
      localHealth.parsed?.status === "PASS" &&
      backupDryRun.parsed?.status === "PASS" &&
      restoreDrillDryRun.parsed?.status === "PASS" &&
      restoreDrillDryRun.parsed?.mode === "dry-run" &&
      runtimeTaskDryRun.parsed?.status === "PASS" &&
      runtimeTaskDryRun.parsed?.mode === "dry_run" &&
      healthTaskDryRun.parsed?.status === "PASS" &&
      healthTaskDryRun.parsed?.mode === "dry_run" &&
      evidenceSecretAudit.status === "PASS"
  );
  const openTasks = taskSummary.open_tasks;
  const productionReady = requiredFilesOk && coreAutomationOk && openTasks.length === 0;

  const summary = {
    status: productionReady ? "PASS" : "BLOCKED",
    checked_at: new Date().toISOString(),
    production_ready: productionReady,
    required_files_ok: requiredFilesOk,
    core_automation_ok: coreAutomationOk,
    task_summary: taskSummary,
    automated_checks: automatedChecks,
    blocker_summary: openTasks.map((task) => ({
      id: task.id,
      status: task.status,
      task: task.task
    }))
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = productionReady ? 0 : 3;
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
