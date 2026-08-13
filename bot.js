const http = require("http");

const BITRIX_WEBHOOK_URL = process.env.BITRIX_WEBHOOK_URL;
const BITRIX_BOT_TOKEN = process.env.BITRIX_BOT_TOKEN;
const BOT_ID = Number(process.env.BOT_ID || 1787);

const PORT = process.env.PORT || 10000;

console.log("========================================");
console.log("MLK BITRIX FETCH TOKEN TEST");
console.log("========================================");
console.log("BITRIX_WEBHOOK_URL:", BITRIX_WEBHOOK_URL ? "OK" : "MISSING");
console.log("BITRIX_BOT_TOKEN:", BITRIX_BOT_TOKEN ? "OK" : "MISSING");
console.log("BOT_ID:", BOT_ID);
console.log("PORT:", PORT);
console.log("========================================");

async function bitrix(method, params = {}) {
  const url =
    BITRIX_WEBHOOK_URL.replace(/\/$/, "") +
    "/" +
    method;

  console.log("");
  console.log("➡️ BITRIX API:", method);
  console.log("📤 PARAMS:", JSON.stringify(params));

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(params)
    });

    const text = await response.text();

    console.log("⬅️ HTTP:", response.status);
    console.log("⬅️ RESPONSE:", text);

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      console.log("❌ Ответ не JSON");
      return null;
    }

    if (data.error) {
      console.log(
        "❌ BITRIX ERROR:",
        data.error,
        data.error_description || ""
      );
    }

    return data;

  } catch (error) {
    console.log("🔥 FETCH ERROR:", error.message);
    return null;
  }
}

async function testFetch() {
  console.log("");
  console.log("========================================");
  console.log("🔄 TEST imbot.v2.Event.get");
  console.log("========================================");

  const params = {
    botId: BOT_ID,
    botToken: BITRIX_BOT_TOKEN,
    offset: 0
  };

  const result = await bitrix(
    "imbot.v2.Event.get",
    params
  );

  console.log("");
  console.log("========================================");
  console.log("🏁 TEST FINISHED");
  console.log("========================================");

  if (result?.result) {
    console.log("✅ Bitrix принял botToken.");

    console.log(
      "EVENTS:",
      JSON.stringify(result.result.events || [], null, 2)
    );

    console.log(
      "NEXT OFFSET:",
      result.result.nextOffset
    );

    console.log(
      "HAS MORE:",
      result.result.hasMore
    );
  } else {
    console.log("❌ Bitrix НЕ вернул result.");
    console.log("Проверяем ошибку выше.");
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end("MLK FETCH TOKEN TEST OK");
});

server.listen(PORT, () => {
  console.log("");
  console.log("🚀 SERVER STARTED");
  console.log("PORT:", PORT);

  setTimeout(testFetch, 2000);
});