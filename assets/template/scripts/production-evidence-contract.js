const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const PRODUCTIONIZATION_ROOT = path.join(
  PROJECT_ROOT,
  "docs",
  "maintenance",
  "GO-LINEBOT-PRODUCTIONIZATION-001"
);
const EVIDENCE_ROOT = path.join(PRODUCTIONIZATION_ROOT, "evidence-records");

const SECRET_SCAN_RULES = [
  {
    id: "line-channel-secret-name",
    description: "LINE channel secret variable name must not appear in final evidence records.",
    pattern: /\bLINE_CHANNEL_SECRET\b/i
  },
  {
    id: "line-channel-access-token-name",
    description: "LINE channel access token variable name must not appear in final evidence records.",
    pattern: /\bLINE_CHANNEL_ACCESS_TOKEN\b/i
  },
  {
    id: "local-model-api-token-name",
    description: "Local model API token variable name must not appear in final evidence records.",
    pattern: /\bLOCAL_MODEL_API_TOKEN\b/i
  },
  {
    id: "secret-or-token-assignment",
    description: "Environment-style secret/token/key assignments must not appear in final evidence records.",
    pattern: /^\s*[A-Z0-9_]*(SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*\s*=/im
  },
  {
    id: "authorization-json-key",
    description: "Authorization headers must not be recorded in final evidence records.",
    pattern: /"authorization"\s*:/i
  },
  {
    id: "bearer-token",
    description: "Bearer token values must not be recorded in final evidence records.",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/i
  },
  {
    id: "line-reply-token",
    description: "LINE replyToken values or fields must not be recorded in final evidence records.",
    pattern: /\breplyToken\b/
  },
  {
    id: "env-file-reference",
    description: "Evidence records must not include .env file contents or paths.",
    pattern: /(^|[`"'\\/\s])\.env(\b|[`"'\s]|$)/i
  }
];

const REQUIRED_EVIDENCE = [
  {
    id: "gate-a-runtime-task",
    file: "gate-a-runtime-task.json",
    gate: "A",
    required_status: "PASS",
    purpose: "Approved runtime scheduled task exists and query proves retry settings.",
    next_action: "Run Gate A approved scheduled task creation, query the task, and verify local health."
  },
  {
    id: "gate-b-public-webhook",
    file: "gate-b-public-webhook.json",
    gate: "B",
    required_status: "PASS",
    purpose: "Approved public health and unsigned webhook checks passed.",
    next_action: "After Gate B approval, run npm run prod:public:execute and record sanitized output."
  },
  {
    id: "gate-b-line-console",
    file: "gate-b-line-console.json",
    gate: "B",
    required_status: "PASS",
    purpose: "LINE Console webhook URL evidence is recorded without secrets.",
    next_action: "Record sanitized LINE Console webhook URL evidence without tokens or secrets."
  },
  {
    id: "line-manual-smoke",
    file: "line-manual-smoke.json",
    gate: "Manual",
    required_status: "PASS",
    purpose: "Real LINE private/group/search/manual smoke scenarios passed.",
    next_action: "Run real LINE smoke scenarios and record sanitized runtime log references."
  },
  {
    id: "gate-d-data-protection",
    file: "gate-d-data-protection.json",
    gate: "D",
    required_status: "PASS",
    purpose: "Backup execution and copied restore drill evidence passed.",
    next_action: "After Gate D approval, run backup and restore drill execute commands and record manifests."
  },
  {
    id: "gate-e-monitoring",
    file: "gate-e-monitoring.json",
    gate: "E",
    required_status: "PASS",
    purpose: "Health scheduled task and bounded log evidence passed.",
    next_action: "After Gate E approval, create health scheduled task and record query/log evidence."
  },
  {
    id: "gate-f-g-policy",
    file: "gate-f-g-policy.json",
    gate: "F/G",
    required_status: "PASS",
    purpose: "Allowed changes and incident severity decisions are approved.",
    next_action: "Record explicit approval for allowed changes and incident severity levels."
  },
  {
    id: "gate-h-go-live-approval",
    file: "gate-h-go-live-approval.json",
    gate: "H",
    required_status: "PASS",
    purpose: "User explicitly approved final production status.",
    next_action: "Only after all other records PASS, record final user go-live approval."
  }
];

function evidencePath(record) {
  return path.join(EVIDENCE_ROOT, record.file);
}

function skeleton(record) {
  return {
    status: "BLOCKED",
    approved: false,
    recorded_at: null,
    evidence_summary: `BLOCKED: ${record.purpose}`,
    secret_free: true,
    id: record.id,
    gate: record.gate,
    purpose: record.purpose,
    next_action: record.next_action,
    notes: "Initialized placeholder. Replace with PASS only after the matching approved action and sanitized evidence are complete."
  };
}

function parseEvidence(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      exists: false,
      status: "BLOCKED",
      error: "missing evidence record"
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      exists: true,
      status: parsed.status || "BLOCKED",
      approved: parsed.approved === true,
      recorded_at: parsed.recorded_at || null,
      recorded_at_valid: typeof parsed.recorded_at === "string" && !Number.isNaN(Date.parse(parsed.recorded_at)),
      evidence_summary_present: typeof parsed.evidence_summary === "string" && parsed.evidence_summary.trim().length > 0,
      secret_free: parsed.secret_free === true,
      id_matches: parsed.id === undefined || parsed.id === path.basename(filePath, ".json")
    };
  } catch (error) {
    return {
      exists: true,
      status: "FAIL",
      error: error?.message || String(error)
    };
  }
}

function scanEvidenceSecrets() {
  const findings = [];
  const files = REQUIRED_EVIDENCE.map((record) => ({
    id: record.id,
    file: evidencePath(record)
  }));

  for (const item of files) {
    if (!fs.existsSync(item.file)) {
      continue;
    }

    let text;
    try {
      text = fs.readFileSync(item.file, "utf8");
    } catch (error) {
      findings.push({
        id: item.id,
        file: item.file,
        rule_id: "evidence-read-error",
        description: "Evidence file could not be read for secret audit.",
        error: error?.message || String(error)
      });
      continue;
    }

    for (const rule of SECRET_SCAN_RULES) {
      if (rule.pattern.test(text)) {
        findings.push({
          id: item.id,
          file: item.file,
          rule_id: rule.id,
          description: rule.description
        });
      }
    }
  }

  return {
    status: findings.length === 0 ? "PASS" : "FAIL",
    checked_at: new Date().toISOString(),
    files_scanned: files.filter((item) => fs.existsSync(item.file)).length,
    findings_count: findings.length,
    findings
  };
}

function recordStatus(record) {
  const filePath = evidencePath(record);
  const details = parseEvidence(filePath);
  const pass =
    details.status === record.required_status &&
    details.approved === true &&
    details.secret_free === true &&
    details.id_matches === true &&
    details.recorded_at_valid === true &&
    details.evidence_summary_present === true;

  return {
    id: record.id,
    file: filePath,
    purpose: record.purpose,
    required_status: record.required_status,
    status: pass ? "PASS" : details.status === "FAIL" ? "FAIL" : "BLOCKED",
    details
  };
}

function evidenceStatus() {
  return REQUIRED_EVIDENCE.map(recordStatus);
}

module.exports = {
  EVIDENCE_ROOT,
  PRODUCTIONIZATION_ROOT,
  REQUIRED_EVIDENCE,
  evidencePath,
  evidenceStatus,
  scanEvidenceSecrets,
  skeleton
};
