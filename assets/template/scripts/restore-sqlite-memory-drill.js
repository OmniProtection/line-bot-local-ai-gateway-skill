const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SOURCE_DB = path.join(PROJECT_ROOT, "data", "linebot-memory.sqlite");
const DRILL_ROOT = path.join(PROJECT_ROOT, "backups", "linebot-memory-restore-drill");

function hasFlag(name) {
  return process.argv.includes(name);
}

function timestampForPath() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function assertInsideProject(filePath) {
  const resolved = path.resolve(filePath);
  if (!resolved.toLowerCase().startsWith(PROJECT_ROOT.toLowerCase() + path.sep.toLowerCase())) {
    throw new Error(`Refusing to write outside project root: ${resolved}`);
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const input = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

function inspectDatabase(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma("integrity_check", { simple: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    return { integrity, tables };
  } finally {
    db.close();
  }
}

async function buildSummary(mode, drillDbPath) {
  const sourceInspection = inspectDatabase(SOURCE_DB);
  const summary = {
    status: "PASS",
    mode,
    created_at: new Date().toISOString(),
    source_db: SOURCE_DB,
    source_sha256: await sha256File(SOURCE_DB),
    source_integrity_check: sourceInspection.integrity,
    source_tables: sourceInspection.tables,
    drill_db: drillDbPath,
    live_db_mutated: false,
    execute_required: mode === "dry-run"
  };

  if (mode === "execute") {
    const drillInspection = inspectDatabase(drillDbPath);
    summary.drill_sha256 = await sha256File(drillDbPath);
    summary.drill_integrity_check = drillInspection.integrity;
    summary.drill_tables = drillInspection.tables;
    summary.table_match = JSON.stringify(sourceInspection.tables) === JSON.stringify(drillInspection.tables);
  }

  return summary;
}

async function main() {
  if (!fs.existsSync(SOURCE_DB)) {
    throw new Error(`SQLite memory DB not found: ${SOURCE_DB}`);
  }

  const execute = hasFlag("--execute");
  const drillDir = path.join(DRILL_ROOT, timestampForPath());
  const drillDbPath = path.join(drillDir, "linebot-memory.restore-drill.sqlite");

  if (!execute) {
    const summary = await buildSummary("dry-run", drillDbPath);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  assertInsideProject(drillDbPath);
  fs.mkdirSync(drillDir, { recursive: true });
  fs.copyFileSync(SOURCE_DB, drillDbPath);
  const summary = await buildSummary("execute", drillDbPath);
  const manifestPath = path.join(drillDir, "restore-drill-manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  summary.manifest_path = manifestPath;
  console.log(JSON.stringify(summary, null, 2));
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
