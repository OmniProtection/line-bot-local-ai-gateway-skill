const fs = require("fs");
const path = require("path");
const { PRODUCTIONIZATION_ROOT, evidenceStatus, scanEvidenceSecrets } = require("./production-evidence-contract");

const OUTPUT_PATH = path.join(PRODUCTIONIZATION_ROOT, "approval-queue.md");

const GATES = [
  {
    id: "gate-a-runtime-task",
    gate: "A",
    area: "Runtime supervision",
    approval_phrase: "我批准執行 Gate A：建立 LINE BOT runtime Windows Scheduled Task",
    precheck: "npm run prod:task:runtime:dry-run",
    approved_action: "node scripts/register-production-scheduled-task.js --task=runtime --execute",
    evidence_file: "evidence-records/gate-a-runtime-task.json",
    why_blocked: "Creates or updates Windows Task Scheduler state and changes login startup behavior."
  },
  {
    id: "gate-b-public-webhook",
    gate: "B",
    area: "Public webhook verification",
    approval_phrase: "我批准執行 Gate B：驗證公開 LINE BOT webhook endpoint",
    precheck: "npm run prod:public:dry-run",
    approved_action: "npm run prod:public:execute",
    evidence_file: "evidence-records/gate-b-public-webhook.json",
    why_blocked: "Contacts the public webhook route and records public endpoint behavior."
  },
  {
    id: "gate-b-line-console",
    gate: "B",
    area: "LINE Console webhook URL evidence",
    approval_phrase: "我批准記錄 Gate B：LINE Console webhook URL 證據",
    precheck: "User checks LINE Console manually.",
    approved_action: "Record sanitized LINE Console webhook URL evidence only.",
    evidence_file: "evidence-records/gate-b-line-console.json",
    why_blocked: "Requires user-provided LINE Console evidence or account-side confirmation."
  },
  {
    id: "line-manual-smoke",
    gate: "Manual",
    area: "Real LINE smoke test",
    approval_phrase: "我批准執行 Manual Gate：真實 LINE smoke test",
    precheck: "npm run prod:runtime:status",
    approved_action: "Run private/group/search/memory LINE scenarios and record sanitized results.",
    evidence_file: "evidence-records/line-manual-smoke.json",
    why_blocked: "Requires real LINE messages and user-observed behavior evidence."
  },
  {
    id: "gate-d-data-protection",
    gate: "D",
    area: "Data protection",
    approval_phrase: "我批准執行 Gate D：SQLite backup 與 copied restore drill",
    precheck: "npm run prod:backup:dry-run; npm run prod:restore-drill:dry-run",
    approved_action: "npm run prod:backup:execute; npm run prod:restore-drill:execute",
    evidence_file: "evidence-records/gate-d-data-protection.json",
    why_blocked: "Writes backup and copied restore-drill artifacts."
  },
  {
    id: "gate-e-monitoring",
    gate: "E",
    area: "Monitoring",
    approval_phrase: "我批准執行 Gate E：建立 LINE BOT health check Windows Scheduled Task",
    precheck: "npm run prod:task:health:dry-run; npm run prod:health:local:log",
    approved_action: "node scripts/register-production-scheduled-task.js --task=health --execute",
    evidence_file: "evidence-records/gate-e-monitoring.json",
    why_blocked: "Creates or updates Windows Task Scheduler state for periodic health checks."
  },
  {
    id: "gate-f-g-policy",
    gate: "F/G",
    area: "Operating policy",
    approval_phrase: "我批准 Gate F/G：allowed production changes 與 incident severity policy",
    precheck: "Review operational-decision-record.md",
    approved_action: "Record explicit policy approval evidence.",
    evidence_file: "evidence-records/gate-f-g-policy.json",
    why_blocked: "Changes operating authority and incident response expectations."
  },
  {
    id: "gate-h-go-live-approval",
    gate: "H",
    area: "Final go-live approval",
    approval_phrase: "我批准 Gate H：LINE BOT 正式 production go-live",
    precheck: "npm run prod:readiness; npm run prod:go-live",
    approved_action: "Record final approval only after all other evidence records PASS.",
    evidence_file: "evidence-records/gate-h-go-live-approval.json",
    why_blocked: "Final production claim requires every prior gate to be proven PASS first."
  }
];

function markdownEscape(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderQueue(records, secretAudit) {
  const evidenceById = new Map(records.map((record) => [record.id, record]));
  const pending = GATES.filter((gate) => evidenceById.get(gate.id)?.status !== "PASS");
  const lines = [
    "# LINE Bot Production Approval Queue",
    "",
    "## Purpose",
    "",
    "This generated queue lists the explicit approvals needed to move productionization gates from BLOCKED or CEO_DECISION_REQUIRED to PASS. It does not approve, execute, deploy, create scheduled tasks, contact public endpoints, write backups, or mutate LINE Console settings.",
    "",
    "## Summary",
    "",
    `- Generated at: ${new Date().toISOString()}`,
    `- Gates total: ${GATES.length}`,
    `- Gates PASS: ${GATES.length - pending.length}`,
    `- Gates pending approval/evidence: ${pending.length}`,
    `- Evidence secret audit: ${secretAudit.status}`,
    `- Evidence secret findings: ${secretAudit.findings_count}`,
    "",
    "## Pending Queue",
    "",
    "| Order | Gate | Area | Status | Required User Approval Phrase | Evidence File |",
    "| ---: | --- | --- | --- | --- | --- |"
  ];

  for (const [index, gate] of pending.entries()) {
    const evidence = evidenceById.get(gate.id);
    lines.push(
      `| ${index + 1} | ${gate.gate} | ${markdownEscape(gate.area)} | ${evidence?.status || "BLOCKED"} | ${markdownEscape(gate.approval_phrase)} | ${gate.evidence_file} |`
    );
  }

  if (pending.length === 0) {
    lines.push("| 0 | all | all gates complete | PASS | none | all evidence records PASS |");
  }

  lines.push("");
  lines.push("## Gate Details");
  lines.push("");

  for (const gate of GATES) {
    const evidence = evidenceById.get(gate.id);
    lines.push(`### ${gate.gate} - ${gate.area}`);
    lines.push("");
    lines.push(`- Status: ${evidence?.status || "BLOCKED"}`);
    lines.push(`- Why blocked: ${gate.why_blocked}`);
    lines.push(`- Approval phrase: ${gate.approval_phrase}`);
    lines.push(`- Safe precheck: ${gate.precheck}`);
    lines.push(`- Approved action: ${gate.approved_action}`);
    lines.push(`- Evidence file: ${gate.evidence_file}`);
    lines.push("");
  }

  lines.push("## Safe Queue Commands");
  lines.push("");
  lines.push("```text");
  lines.push("npm run prod:approval-queue");
  lines.push("npm run prod:tasks");
  lines.push("npm run prod:evidence:status");
  lines.push("npm run prod:readiness");
  lines.push("npm run prod:go-live");
  lines.push("```");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function main() {
  const records = evidenceStatus();
  const secretAudit = scanEvidenceSecrets();
  const pending = GATES.filter((gate) => records.find((record) => record.id === gate.id)?.status !== "PASS");
  fs.writeFileSync(OUTPUT_PATH, renderQueue(records, secretAudit), "utf8");

  const summary = {
    status: secretAudit.status === "PASS" ? "PASS" : "FAIL",
    output_path: OUTPUT_PATH,
    gates_total: GATES.length,
    gates_pass: GATES.length - pending.length,
    gates_pending_approval_or_evidence: pending.length,
    next_gate: pending[0]?.id || null,
    next_approval_phrase: pending[0]?.approval_phrase || null,
    evidence_secret_audit_status: secretAudit.status,
    evidence_secret_findings_count: secretAudit.findings_count
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.status === "PASS" ? 0 : 2;
}

main();
