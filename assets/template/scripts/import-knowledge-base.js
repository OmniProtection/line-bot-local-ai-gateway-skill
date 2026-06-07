const fs = require("fs");
const path = require("path");
const { createKnowledgeBaseStore, hashText } = require("../src/knowledgeBaseStore");
const { readConfig } = require("../src/config");

const PROJECT_ROOT = path.join(__dirname, "..");
const SUPPORTED_EXTENSIONS = new Set([".md", ".txt"]);

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      args[match[1]] = match[2];
    }
  }
  return args;
}

function listKnowledgeFiles(sourceDir) {
  if (!fs.existsSync(sourceDir)) {
    return [];
  }

  const files = [];
  const pending = [sourceDir];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }
  return files.sort();
}

function extractTitle(filePath, content) {
  const heading = String(content || "").match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : path.basename(filePath);
}

function chunkContent(content, maxChars) {
  const paragraphs = String(content || "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks = [];
  let current = "";

  function pushCurrent() {
    const text = current.trim();
    if (text) {
      chunks.push(text);
    }
    current = "";
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      pushCurrent();
      for (let index = 0; index < paragraph.length; index += maxChars) {
        chunks.push(paragraph.slice(index, index + maxChars).trim());
      }
      continue;
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChars) {
      pushCurrent();
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  pushCurrent();
  return chunks;
}

function importKnowledgeBase({ source = "kb", dbPath = undefined, chunkChars = undefined } = {}) {
  const config = readConfig();
  const sourceDir = path.resolve(PROJECT_ROOT, source || config.knowledgeBaseSourceDir || "kb");
  const maxChunkChars = Math.max(200, Number(chunkChars || config.knowledgeBaseChunkChars || 900));
  const store = createKnowledgeBaseStore(dbPath);
  const files = listKnowledgeFiles(sourceDir);
  const imported = [];

  try {
    for (const filePath of files) {
      const content = fs.readFileSync(filePath, "utf8");
      const relativePath = path.relative(PROJECT_ROOT, filePath).replace(/\\/g, "/");
      const title = extractTitle(filePath, content);
      const stats = fs.statSync(filePath);
      const documentId = store.upsertDocument({
        sourcePath: relativePath,
        title,
        contentHash: hashText(content),
        updatedAt: stats.mtime.toISOString()
      });
      const chunks = chunkContent(content, maxChunkChars).map((chunk, index) => ({
        chunkIndex: index,
        title,
        content: chunk,
        contentHash: hashText(chunk)
      }));
      const chunkCount = store.replaceChunks(documentId, chunks);
      imported.push({
        sourcePath: relativePath,
        documentId,
        chunkCount
      });
    }
  } finally {
    store.close();
  }

  return {
    status: "PASS",
    sourceDir,
    fileCount: files.length,
    imported
  };
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  const result = importKnowledgeBase({
    source: args.source,
    dbPath: args.db,
    chunkChars: args["chunk-chars"]
  });
  console.log(JSON.stringify(result, null, 2));
}

module.exports = {
  chunkContent,
  importKnowledgeBase,
  listKnowledgeFiles
};
