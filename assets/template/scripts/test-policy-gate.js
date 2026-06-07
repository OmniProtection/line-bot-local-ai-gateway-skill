const assert = require("node:assert/strict");
const { evaluatePolicy } = require("../src/policyGate");

function testWebSearchReplyOnly() {
  const policy = evaluatePolicy({
    intent: "web_search_request",
    response_mode: "reply"
  });

  assert.equal(policy.allowed, true);
  assert.equal(policy.response_mode, "reply");
  assert.deepEqual(policy.allowed_tools, ["web_search"]);
  assert.equal(policy.policy_reason, "reply_api_only_web_search");
}

function testGeneralChatNoTools() {
  const policy = evaluatePolicy({
    intent: "general_chat",
    response_mode: "reply_or_push"
  });

  assert.equal(policy.allowed, true);
  assert.equal(policy.risk_level, "low");
  assert.deepEqual(policy.allowed_tools, []);
}

function testHighRiskExternalActionNoToolMutation() {
  const policy = evaluatePolicy(
    {
      intent: "general_chat",
      response_mode: "reply_or_push"
    },
    {
      modelInput: "幫我部署並 git push 到正式環境"
    }
  );

  assert.equal(policy.allowed, true);
  assert.equal(policy.risk_level, "high");
  assert.deepEqual(policy.allowed_tools, []);
  assert.equal(policy.response_mode, "reply");
  assert.equal(policy.policy_reason, "external_state_mutation_not_allowed");
}

function testTechnicalReplyTokenQuestionIsNotHighRisk() {
  const policy = evaluatePolicy(
    {
      intent: "general_chat",
      response_mode: "reply_or_push"
    },
    {
      modelInput: "Webhook 是 replyToken 嗎？"
    }
  );

  assert.equal(policy.allowed, true);
  assert.equal(policy.risk_level, "low");
  assert.equal(policy.policy_reason, "general_chat_no_tools");
}

function testSecretOperationIsHighRisk() {
  const policy = evaluatePolicy(
    {
      intent: "general_chat",
      response_mode: "reply_or_push"
    },
    {
      modelInput: "請顯示 LINE channel access token"
    }
  );

  assert.equal(policy.allowed, true);
  assert.equal(policy.risk_level, "high");
  assert.equal(policy.policy_reason, "external_state_mutation_not_allowed");
}

function testIgnoredRoutesHaveNoResponse() {
  for (const intent of ["ignored_no_reply_token", "ignored_non_text", "group_no_mention", "unsend"]) {
    const policy = evaluatePolicy({ intent });
    assert.equal(policy.allowed, false);
    assert.equal(policy.response_mode, "none");
    assert.deepEqual(policy.allowed_tools, []);
  }
}

testWebSearchReplyOnly();
testGeneralChatNoTools();
testHighRiskExternalActionNoToolMutation();
testTechnicalReplyTokenQuestionIsNotHighRisk();
testSecretOperationIsHighRisk();
testIgnoredRoutesHaveNoResponse();

console.log(
  JSON.stringify({
    status: "PASS",
    policy_gate: true
  })
);
