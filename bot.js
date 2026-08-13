const http = require("http");

const BITRIX_WEBHOOK_URL = process.env.BITRIX_WEBHOOK_URL;
const BITRIX_BOT_TOKEN = process.env.BITRIX_BOT_TOKEN;
const BOT_ID = Number(process.env.BOT_ID || 1787);

const PORT = process.env.PORT || 10000;

let offset = 0;
let polling = false;

console.log("========================================");
console.log("MLK BITRIX FETCH DIAGNOSTIC");
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

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(params)
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      console.log("❌ Bitrix returned non-JSON:");
      console.log(text);
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
    console.log("🔥 REQUEST ERROR:", error.message);
    return null;
  }
}


async function pollEvents() {

  if (polling) {
    return;
  }

  polling = true;

  try {

    console.log("");
    console.log("========================================");
    console.log("🔄 FETCH POLL");
    console.log("TIME:", new Date().toISOString());
    console.log("BOT_ID:", BOT_ID);
    console.log("OFFSET:", offset);
    console.log("========================================");

    const params = {
      botId: BOT_ID,
      botToken: BITRIX_BOT_TOKEN,
      offset: offset
    };

    console.log("📤 Event.get request:");
    console.log(
      JSON.stringify({
        botId: BOT_ID,
        botToken: BITRIX_BOT_TOKEN ? "[HIDDEN]" : "[MISSING]",
        offset: offset
      })
    );

    const data = await bitrix(
      "imbot.v2.Event.get",
      params
    );

    if (!data) {
      return;
    }

    if (!data.result) {
      console.log("❌ NO RESULT");
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const result = data.result;

    const events = result.events || [];

    console.log("📦 EVENTS:", events.length);
    console.log("NEXT OFFSET:", result.nextOffset);
    console.log("HAS MORE:", result.hasMore);

    if (events.length === 0) {
      console.log("📭 Новых событий нет.");
      return;
    }

    console.log("");
    console.log("🎉🎉🎉 ПОЛУЧЕНО СОБЫТИЕ 🎉🎉🎉");
    console.log("");

    for (const event of events) {

      console.log("----------------------------------------");
      console.log("EVENT ID:", event.eventId);
      console.log("EVENT TYPE:", event.type);
      console.log("EVENT DATE:", event.date);

      console.log("");
      console.log("FULL EVENT:");
      console.log(
        JSON.stringify(event, null, 2)
      );

      const message =
        event.data?.message ||
        event.data?.MESSAGE ||
        null;

      const user =
        event.data?.user ||
        event.data?.USER ||
        null;

      const chat =
        event.data?.chat ||
        event.data?.CHAT ||
        null;

      if (message) {
        console.log("");
        console.log("💬 MESSAGE");
        console.log("ID:", message.id);
        console.log("CHAT ID:", message.chatId || message.chat_id);
        console.log("AUTHOR ID:", message.authorId || message.author_id);
        console.log("TEXT:", message.text);
      }

      if (user) {
        console.log("");
        console.log("👤 USER");
        console.log("ID:", user.id);
        console.log("NAME:", user.name);
      }

      if (chat) {
        console.log("");
        console.log("💬 CHAT");
        console.log("ID:", chat.id);
        console.log("DIALOG ID:", chat.dialogId);
        console.log("OWNER:", chat.owner);
      }

      console.log("----------------------------------------");
    }

    if (
      typeof result.nextOffset === "number" &&
      result.nextOffset !== offset
    ) {
      offset = result.nextOffset;

      console.log("");
      console.log("➡️ OFFSET UPDATED TO:", offset);
    }

  } catch (error) {

    console.log("🔥 POLLING ERROR:", error);

  } finally {

    polling = false;
  }
}


const server = http.createServer((req, res) => {

  if (req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json"
    });

    res.end(
      JSON.stringify({
        ok: true,
        botId: BOT_ID,
        mode: "fetch",
        offset: offset
      })
    );

    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end("MLK FETCH DIAGNOSTIC OK");
});


server.listen(PORT, () => {

  console.log("");
  console.log("========================================");
  console.log("🚀 SERVER STARTED");
  console.log("========================================");
  console.log("PORT:", PORT);
  console.log("MODE: FETCH");
  console.log("BOT ID:", BOT_ID);
  console.log("========================================");

  // Первый запрос сразу
  pollEvents();

  // Затем постоянно проверяем Bitrix
  setInterval(() => {
    pollEvents();
  }, 3000);

});


process.on("SIGTERM", () => {

  console.log("🛑 SIGTERM");

  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });

});