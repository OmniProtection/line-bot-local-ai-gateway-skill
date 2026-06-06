const assert = require("node:assert/strict");
const path = require("node:path");
const { createGatewayStore } = require("../src/gatewayStore");

function enqueueSample(store, overrides = {}) {
  return store.enqueueJob({
    jobType: overrides.jobType || "general_reply",
    requestId: overrides.requestId || "req-1",
    webhookEventId: overrides.webhookEventId || "event-1",
    dedupeKey: overrides.dedupeKey || "dedupe-1",
    maxAttempts: overrides.maxAttempts || 3,
    payload: overrides.payload || { modelInput: "private payload can live in job payload" },
    createdAt: overrides.createdAt || "2026-06-05T00:00:00.000Z",
    nextRunAt: overrides.nextRunAt || "2026-06-05T00:00:00.000Z"
  });
}

function testIdempotentEnqueueAndComplete() {
  const store = createGatewayStore(":memory:", { enableTestHelpers: true });
  try {
    const first = enqueueSample(store);
    const duplicate = enqueueSample(store);
    assert.equal(first.inserted, true);
    assert.equal(duplicate.duplicate, true);
    assert.equal(store.countJobs(), 1);

    const claimed = store.claimNextJob({
      workerId: "test-worker",
      now: "2026-06-05T00:00:01.000Z"
    });
    assert.equal(claimed.jobType, "general_reply");
    assert.equal(claimed.attemptCount, 1);
    assert.equal(claimed.payload.modelInput, "private payload can live in job payload");

    const completed = store.completeJob(claimed.id, {
      attemptId: claimed.attemptId,
      completedAt: "2026-06-05T00:00:02.000Z"
    });
    assert.equal(completed.status, "completed");
  } finally {
    assert.deepEqual(store.close(), { closed: true });
  }
}

function testRetryAndDeadLetter() {
  const store = createGatewayStore(":memory:", { enableTestHelpers: true });
  try {
    enqueueSample(store, { dedupeKey: "dead-letter", maxAttempts: 2 });

    const first = store.claimNextJob({ workerId: "test-worker", now: "2026-06-05T00:00:01.000Z" });
    const retry = store.failJob(first.id, new Error("temporary"), {
      attemptId: first.attemptId,
      now: "2026-06-05T00:00:02.000Z",
      retryDelayMs: 0
    });
    assert.equal(retry.status, "pending");
    assert.equal(retry.attemptCount, 1);

    const second = store.claimNextJob({ workerId: "test-worker", now: "2026-06-05T00:00:02.000Z" });
    const failed = store.failJob(second.id, new Error("permanent"), {
      attemptId: second.attemptId,
      now: "2026-06-05T00:00:03.000Z",
      retryDelayMs: 0
    });
    assert.equal(failed.status, "failed");
    assert.equal(store.listDeadLetterJobs({}).length, 1);
  } finally {
    store.close();
  }
}

function testRecoverStaleRunningJobs() {
  const store = createGatewayStore(":memory:", { enableTestHelpers: true });
  try {
    enqueueSample(store, { dedupeKey: "stale" });
    const claimed = store.claimNextJob({ workerId: "old-worker", now: "2026-06-05T00:00:00.000Z" });
    assert.equal(claimed.status, "running");

    const recovered = store.recoverStaleRunningJobs({
      olderThanMs: 1000,
      now: "2026-06-05T00:00:02.000Z"
    });
    assert.equal(recovered.recovered, 1);

    const reclaimed = store.claimNextJob({ workerId: "new-worker", now: "2026-06-05T00:00:02.000Z" });
    assert.equal(reclaimed.id, claimed.id);
    assert.equal(reclaimed.attemptCount, 2);
  } finally {
    store.close();
  }
}

function testRestartSimulation() {
  const dbPath = path.resolve(
    __dirname,
    "..",
    "data",
    `test-gateway-store-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`
  );
  const firstStore = createGatewayStore(dbPath, { enableTestHelpers: true });
  enqueueSample(firstStore, {
    dedupeKey: "restart",
    payload: { restart: true }
  });
  firstStore.close();

  const secondStore = createGatewayStore(dbPath, { enableTestHelpers: true });
  try {
    const claimed = secondStore.claimNextJob({
      workerId: "restart-worker",
      now: "2026-06-05T00:00:01.000Z"
    });
    assert.equal(claimed.payload.restart, true);
  } finally {
    secondStore.close();
  }

  const thirdStore = createGatewayStore(dbPath, { enableTestHelpers: true });
  try {
    assert.equal(thirdStore.countJobs(), 1);
  } finally {
    thirdStore.close();
  }
}

testIdempotentEnqueueAndComplete();
testRetryAndDeadLetter();
testRecoverStaleRunningJobs();
testRestartSimulation();

console.log(
  JSON.stringify({
    status: "PASS",
    durable_queue: true,
    retry_dead_letter: true,
    restart_claim: true
  })
);
