const SEARCH_COMMAND_PATTERN = /^(找|搜|查)[：:]([\s\S]*)$/u;

function parseWebSearchCommand(text) {
  if (typeof text !== "string") {
    return { matched: false };
  }

  const match = text.match(SEARCH_COMMAND_PATTERN);
  if (!match) {
    return { matched: false };
  }

  return {
    matched: true,
    command: match[1],
    query: match[2].trim()
  };
}

function getPushTarget(source) {
  if (source?.type === "user" && source.userId) {
    return source.userId;
  }
  if (source?.type === "group" && source.groupId) {
    return source.groupId;
  }
  if (source?.type === "room" && source.roomId) {
    return source.roomId;
  }

  return null;
}

function decideWebSearchRequest(searchCommand, config, source) {
  if (!searchCommand?.matched) {
    return { action: "not_matched" };
  }

  if (!config?.webSearchEnabled) {
    return {
      action: "reply",
      reason: "web_search_disabled",
      text: "網路搜尋功能目前未啟用。"
    };
  }

  if (!config?.webSearchBackgroundPushEnabled) {
    return {
      action: "reply",
      reason: "web_search_push_disabled",
      text: "網路搜尋補送功能目前未啟用。"
    };
  }

  if (!searchCommand.query) {
    const command = searchCommand.command || "查";
    return {
      action: "reply",
      reason: "web_search_empty_query",
      text: `請在 ${command}: 後面加上要搜尋的內容。`
    };
  }

  const pushTarget = getPushTarget(source);
  if (!pushTarget) {
    return {
      action: "reply",
      reason: "web_search_push_target_missing",
      text: "目前無法在這個對話補送搜尋結果。"
    };
  }

  return {
    action: "start",
    pushTarget,
    query: searchCommand.query
  };
}

module.exports = {
  decideWebSearchRequest,
  getPushTarget,
  parseWebSearchCommand
};
