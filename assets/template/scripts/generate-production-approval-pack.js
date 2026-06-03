const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const JARVIS_ROOT = path.resolve(PROJECT_ROOT, "..");
const PRODUCTIONIZATION_ROOT = path.join(
  JARVIS_ROOT,
  "docs",
  "maintenance",
  "GO-LINEBOT-PRODUCTIONIZATION-001"
);
const OUTPUT_PATH = path.join(PRODUCTIONIZATION_ROOT, "approval-execution-plan.md");

const STEPS = [
  {
    gate: "A",
    title: "Runtime Scheduled Task",
    approval: "Approve creating Windows Task Scheduler runtime task.",
    precheck: "npm run prod:task:runtime:dry-run",
    execute: "node scripts/register-production-scheduled-task.js --task=runtime --execute",
    evidence: "evidence-records/gate-a-runtime-task.json",
    pass: "Scheduled task exists, command points to local-free-line-bot, retry policy is present, local health returns PASS."
  },
  {
    gate: "B",
    title: "Public Webhook",
    approval: "Approve contacting the public endpoint.",
    precheck: "npm run prod:public:dry-run",
    execute: "npm run prod:public:execute",
    evidence: "evidence-records/gate-b-public-webhook.json",
    pass: "Public /health returns ok=true and unsigned /webhook returns invalid_signature."
  },
  {
    gate: "B",
    title: "LINE Console",
    approval: "Approve recording LINE Console webhook evidence.",
    precheck: "None. User checks LINE Console manually.",
    execute: "Record sanitized evidence only.",
    evidence: "evidence-records/gate-b-line-console.json",
    pass: "Webhook URL is the approved https URL ending in /webhook, with no secrets included."
  },
  {
    gate: "Manual",
    title: "Real LINE Smoke",
    approval: "Approve real LINE smoke test execution.",
    precheck: "npm run prod:runtime:status",
    execute: "Run private/group/search/memory scenarios from release-checklist.md.",
    evidence: "evidence-records/line-manual-smoke.json",
    pass: "All required scenarios pass with sanitized runtime log references."
  },
  {
    gate: "D",
    title: "Data Protection",
    approval: "Approve backup and copied restore drill execution.",
    precheck: "npm run prod:backup:dry-run && npm run prod:restore-drill:dry-run",
    execute: "npm run prod:backup:execute && npm run prod:restore-drill:execute",
    evidence: "evidence-records/gate-d-data-protection.json",
    pass: "Backup manifest exists, copied drill DB opens, live DB is not mutated, no secrets are included."
  },
  {
    gate: "E",
    title: "Monitoring",
    approval: "Approve creating health scheduled task.",
    precheck: "npm run prod:task:health:dry-run && npm run prod:health:local:log",
    execute: "node scripts/register-production-scheduled-task.js --task=health --execute",
    evidence: "evidence-records/gate-e-monitoring.json",
    pass: "Health task exists with retry policy and bounded health log is written."
  },
  {
    gate: "F/G",
    title: "Operating Policy",
    approval: "Approve allowed production changes and incident severity levels.",
    precheck: "Review operational-decision-record.md",
    execute: "Record approval only.",
    evidence: "evidence-records/gate-f-g-policy.json",
    pass: "Allowed changes and severity levels are explicitly approved."
  },
  {
    gate: "H",
    title: "Final Go-Live Approval",
    approval: "Approve final production status claim.",
    precheck: "npm run prod:readiness && npm run prod:go-live",
    execute: "Record approval only after all other evidence records PASS.",
    evidence: "evidence-records/gate-h-go-live-approval.json",
    pass: "User approval is recorded and final go-live gate returns PASS."
  }
];

function render() {
  const lines = [
    "# LINE Bot Approval Execution Plan",
    "",
    "## Purpose",
    "",
    "This plan lists the exact approved-action sequence needed to move from BLOCKED to production-ready. It is not an approval and does not execute any command.",
    "",
    "## Rules",
    "",
    "- Run precheck commands before requesting approval.",
    "- Do not run execute commands until the matching gate is explicitly approved.",
    "- Record only sanitized evidence.",
    "- Do not include `.env`, LINE tokens, Channel Secret, reply tokens, private message bodies, or secret screenshots.",
    "- After each approved action, update the matching evidence record with `status=PASS`, `approved=true`, `secret_free=true`, valid `recorded_at`, and an evidence summary.",
    "",
    "## Steps",
    ""
  ];

  for (const [index, step] of STEPS.entries()) {
    lines.push(`### ${index + 1}. Gate ${step.gate} - ${step.title}`);
    lines.push("");
    lines.push(`- Approval needed: ${step.approval}`);
    lines.push(`- Precheck: \`${step.precheck}\``);
    lines.push(`- Execute after approval: \`${step.execute}\``);
    lines.push(`- Evidence file: \`${step.evidence}\``);
    lines.push(`- PASS condition: ${step.pass}`);
    lines.push("");
  }

  lines.push("## Final Verification");
  lines.push("");
  lines.push("```text");
  lines.push("npm run prod:approval-queue");
  lines.push("npm run prod:tasks");
  lines.push("npm run prod:evidence:init");
  lines.push("npm run prod:evidence:status");
  lines.push("npm run prod:evidence:secret-audit");
  lines.push("npm run prod:readiness");
  lines.push("npm run prod:go-live");
  lines.push("npm run prod:report");
  lines.push("```");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function main() {
  fs.writeFileSync(OUTPUT_PATH, render(), "utf8");
  console.log(
    JSON.stringify(
      {
        status: "PASS",
        output_path: OUTPUT_PATH,
        steps: STEPS.length
      },
      null,
      2
    )
  );
}

main();
