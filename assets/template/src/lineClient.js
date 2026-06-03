const line = require("@line/bot-sdk");

function createLineMiddleware(config) {
  return line.middleware({
    channelSecret: config.lineChannelSecret,
    channelAccessToken: config.lineChannelAccessToken
  });
}

function createLineClient(config) {
  return new line.messagingApi.MessagingApiClient({
    channelAccessToken: config.lineChannelAccessToken
  });
}

async function replyText(client, replyToken, text) {
  return client.replyMessage({
    replyToken,
    messages: [
      {
        type: "text",
        text
      }
    ]
  });
}

async function pushText(client, to, text) {
  return client.pushMessage({
    to,
    messages: [
      {
        type: "text",
        text
      }
    ]
  });
}

module.exports = {
  createLineClient,
  createLineMiddleware,
  pushText,
  replyText
};
