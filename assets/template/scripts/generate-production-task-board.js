const fs = require("fs");
const path = require("path");
const { REQUIRED_EVIDENCE, PRODUCTIONIZATION_ROOT, evidenceStatus, scanEvidenceSecrets } = require("./production-evidence-contract");

const TASK_BACKLOG = path.join(PRODUCTIONIZATION_ROOT, "task-backlog.md");
const OUTPUT_PATH = path.join(PRODUCTIONIZATION_ROOT, "task-status.md");

const PHASE_NAMES = {
  "0": "Baseline",
  "1": "Local Runtime Supervision",
  "2": "Public Ingress And LINE Webhook",
  "3": "LM Studio Readiness",
  "4": "Observability",
  "5": "Data Protection",
  "6": "Release Management",
  "7": "Incident Response",
  "8": "Final Go-Live"
};

function parseTaskBacklog() {
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

function summarizeByStatus(items) {
  return items.reduce((summary, item) => {
    summary[item.status] = (summary[item.status] || 0) + 1;
    return summary;
  }, {});
}

function phaseStatus(tasks) {
  if (tasks.some((task) => task.status === "FAIL")) {
    return "FAIL";
  }
  if (tasks.every((task) => task.status === "PASS")) {
    return "PASS";
  }
  if (tasks.some((task) => task.status === "BLOCKED")) {
    return "BLOCKED";
  }
  return "CEO_DECISION_REQUIRED";
}

function markdownEscape(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderTaskBoard(tasks, evidence, secretAudit) {
  const byPhase = new Map();
  for (const task of tasks) {
    if (!byPhase.has(task.phase)) {
      byPhase.set(task.phase, []);
    }
    byPhase.get(task.phase).push(task);
  }

  const statusSummary = summarizeByStatus(tasks);
  const openTasks = tasks.filter((task) => task.status !== "PASS");
  const evidenceById = new Map(evidence.map((record) => [record.id, record]));

  const lines = [
    "# LINE Bot Production Task Status",
    "",
    "## Purpose",
    "",
    "This generated task board is derived from `task-backlog.md` and final evidence records. It does not approve, execute, deploy, create scheduled tasks, contact public endpoints, or mutate LINE Console settings.",
    "",
    "## Summary",
    "",
    `- Generated at: ${new Date().toISOString()}`,
    `- Total tasks: ${tasks.length}`,
    `- PASS: ${statusSummary.PASS || 0}`,
    `- CEO_DECISION_REQUIRED: ${statusSummary.CEO_DECISION_REQUIRED || 0}`,
    `- BLOCKED: ${statusSummary.BLOCKED || 0}`,
    `- FAIL: ${statusSummary.FAIL || 0}`,
    `- Evidence required: ${evidence.length}`,
    `- Evidence PASS: ${evidence.filter((item) => item.status === "PASS").length}`,
    `- Evidence BLOCKED: ${evidence.filter((item) => item.status === "BLOCKED").length}`,
    `- Evidence FAIL: ${evidence.filter((item) => item.status === "FAIL").length}`,
    `- Evidence secret audit: ${secretAudit.status}`,
    `- Evidence secret findings: ${secretAudit.findings_count}`,
    "",
    "## Phase Board",
    "",
    "| Phase | Status | PASS | CEO_DECISION_REQUIRED | BLOCKED | FAIL |",
    "| --- | --- | ---: | ---: | ---: | ---: |"
  ];

  for (const [phase, phaseTasks] of [...byPhase.entries()].sort((left, right) => Number(left[0]) - Number(right[0]))) {
    const summary = summarizeByStatus(phaseTasks);
    lines.push(
      `| P${phase} - ${PHASE_NAMES[phase] || `Phase ${phase}`} | ${phaseStatus(phaseTasks)} | ${summary.PASS || 0} | ${summary.CEO_DECISION_REQUIRED || 0} | ${summary.BLOCKED || 0} | ${summary.FAIL || 0} |`
    );
  }

  lines.push("");
  lines.push("## Open Tasks");
  lines.push("");
  lines.push("| Task ID | Status | Task | Required Evidence |");
  lines.push("| --- | --- | --- | --- |");

  for (const task of openTasks) {
    lines.push(`| ${task.id} | ${task.status} | ${markdownEscape(task.task)} | ${markdownEscape(task.evidence)} |`);
  }

  if (openTasks.length === 0) {
    lines.push("| none | PASS | all tasks closed | all evidence present |");
  }

  lines.push("");
  lines.push("## Evidence Gates");
  lines.push("");
  lines.push("| Evidence ID | Gate | Status | Next Action |");
  lines.push("| --- | --- | --- | --- |");

  for (const required of REQUIRED_EVIDENCE) {
    const current = evidenceById.get(required.id);
    lines.push(
      `| ${required.id} | ${required.gate} | ${current?.status || "BLOCKED"} | ${markdownEscape(required.next_action)} |`
    );
  }

  lines.push("");
  lines.push("## Next Executable Commands");
  lines.push("");
  lines.push("```text");
  lines.push("npm run prod:approval-queue");
  lines.push("npm run prod:tasks");
  lines.push("npm run prod:evidence:status");
  lines.push("npm run prod:evidence:secret-audit");
  lines.push("npm run prod:readiness");
  lines.push("npm run prod:go-live");
  lines.push("```");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function main() {
  const tasks = parseTaskBacklog();
  const evidence = evidenceStatus();
  const secretAudit = scanEvidenceSecrets();
  const output = renderTaskBoard(tasks, evidence, secretAudit);
  fs.writeFileSync(OUTPUT_PATH, output, "utf8");

  const statusSummary = summarizeByStatus(tasks);
  const summary = {
    status: secretAudit.status === "PASS" ? "PASS" : "FAIL",
    output_path: OUTPUT_PATH,
    total_tasks: tasks.length,
    by_status: statusSummary,
    evidence_required: evidence.length,
    evidence_pass: evidence.filter((item) => item.status === "PASS").length,
    evidence_blocked: evidence.filter((item) => item.status === "BLOCKED").length,
    evidence_fail: evidence.filter((item) => item.status === "FAIL").length,
    evidence_secret_audit_status: secretAudit.status,
    evidence_secret_findings_count: secretAudit.findings_count
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.status === "PASS" ? 0 : 2;
}

main();
