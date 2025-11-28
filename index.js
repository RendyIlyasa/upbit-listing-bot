// index.js (ESM)
import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Keep-alive (Replit)
const app = express();
app.all("/", (req, res) => res.send("🔥 Upbit Bot is Running"));
function keepAlive() {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`🌐 KeepAlive server running on port ${port}`));
}
keepAlive();

// Env
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ETHERSCAN_API = process.env.ETHERSCAN_API || "";
const UPBIT_WALLET = process.env.UPBIT_WALLET || "";

if (!BOT_TOKEN || !CHAT_ID) {
  console.error("BOT_TOKEN dan CHAT_ID harus diisi pada .env");
  process.exit(1);
}

// Telegram bot (polling)
const bot = new TelegramBot(BOT_TOKEN, {
  polling: {
    interval: 300,
    autoStart: true,
    params: { timeout: 10 }
  }
});
bot.on("polling_error", (error) => console.log("Polling error:", error.message || error));

// Paths & logs
const LOGS_DIR = path.join(__dirname, "logs");
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
function getTodayLogFile() {
  const today = new Date().toISOString().split("T")[0];
  return path.join(LOGS_DIR, `${today}.txt`);
}
function log(text) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${text}\n`;
  fs.appendFileSync(getTodayLogFile(), line);
  console.log(line.trim());
}

// In-memory state
let lastWalletTxHash = null;
let knownMarkets = new Set();

// ----------------------------
// 1) Upbit New Listing Detector (via market API)
// ----------------------------
const UPBIT_MARKET_API = "https://api.upbit.com/v1/market/all";
async function checkUpbitNewListings() {
  try {
    const res = await axios.get(UPBIT_MARKET_API, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
    });
    const markets = res.data || [];
    const currentMarkets = new Set(markets.map(m => m.market));

    if (knownMarkets.size === 0) {
      knownMarkets = currentMarkets;
      log(`Inisialisasi Upbit markets: ${knownMarkets.size} pairs`);
      return;
    }

    for (const m of markets) {
      if (!knownMarkets.has(m.market)) {
        const marketName = m.market;
        const koreanName = m.korean_name || "";
        const englishName = m.english_name || "";
        log(`🚀 NEW LISTING DETECTED: ${marketName} (${englishName})`);

        const msg = `🚀 *UPBIT NEW LISTING DETECTED!*

🪙 *${englishName}* (${koreanName})
📊 Market: \`${marketName}\`
🔗 https://upbit.com/exchange?code=CRIX.UPBIT.${marketName}

⏰ Detected at: ${new Date().toISOString()}`;
        await bot.sendMessage(CHAT_ID, msg, { parse_mode: "Markdown" }).catch(e => log("TG send error: "+e.message));
        knownMarkets.add(m.market);
      }
    }
  } catch (err) {
    log("Upbit Market check error: " + (err.message || err));
  }
}

// ----------------------------
// 2) Wallet Tracker (Etherscan API)
// ----------------------------
async function scanUpbitWallet() {
  if (!ETHERSCAN_API || !UPBIT_WALLET) {
    return "⚠️ ETHERSCAN_API atau UPBIT_WALLET belum diset di .env.";
  }

  try {
    // Etherscan V2 endpoint format (we use the same as sebelumnya)
    const url = `https://api.etherscan.io/v2/api?chainid=1&module=account&action=tokentx&address=${UPBIT_WALLET}&page=1&offset=10&sort=desc&apikey=${ETHERSCAN_API}`;
    const r = await axios.get(url, { timeout: 10000 });
    const txs = r.data?.result;

    if (!txs || txs.length === 0 || typeof txs === "string") {
      return `🔍 Tidak ada token yang masuk baru-baru ini.\n\nStatus: ${r.data?.message || "OK"}`;
    }

    let text = `🔍 *Token Masuk ke Wallet Upbit*\nAlamat: \`${UPBIT_WALLET.slice(0, 10)}...\`\n\n`;
    txs.slice(0, 5).forEach((tx) => {
      const amount = Number(tx.value) / (10 ** (tx.tokenDecimal || 18));
      text += `🪙 *${tx.tokenName || tx.contractAddress}* (${tx.tokenSymbol || "—"})
Jumlah: *${amount.toLocaleString()}*
Dari: \`${tx.from.slice(0, 10)}...\`
[Lihat Tx](https://etherscan.io/tx/${tx.hash})

`;
    });

    return text;
  } catch (err) {
    log("Scan wallet error: " + (err.message || err));
    return "⚠️ Gagal scan wallet Upbit: " + (err.message || err);
  }
}

// ----------------------------
// Telegram commands
// ----------------------------
const menuText = `🔥 *Upbit Listing Detector — Menu*

*Commands:*
/start - Menu utama
/features - Lihat fitur aktif
/logs - Lihat semua log hari ini
/checknow - Jalankan pengecekan manual
/scanwallet - Scan wallet Upbit manual
`;

bot.onText(/\/start/, async (msg) => bot.sendMessage(msg.chat.id, menuText, { parse_mode: "Markdown" }));
bot.onText(/\/features/, async (msg) => {
  const features = `*Fitur Aktif*
• Upbit new listing detector (real-time)
• Wallet Upbit incoming token tracker (scan manual)
• Quick volume check (BTC/ETH)
• Auto-check setiap 30 detik`;
  await bot.sendMessage(msg.chat.id, features, { parse_mode: "Markdown" });
});

// logs command
bot.onText(/\/logs/, async (msg) => {
  try {
    const logFile = getTodayLogFile();
    const today = new Date().toISOString().split("T")[0];
    if (!fs.existsSync(logFile)) return bot.sendMessage(msg.chat.id, `📝 Belum ada log untuk hari ini (${today})`);
    const data = fs.readFileSync(logFile, "utf8").trim();
    if (!data) return bot.sendMessage(msg.chat.id, "Log kosong.");
    // jika terlalu panjang, kirim sebagian terakhir
    const sliced = data.split("\n").slice(-200).join("\n");
    await bot.sendMessage(msg.chat.id, `📝 *Log Hari Ini (${today})*\n\n\`\`\`\n${sliced}\n\`\`\``, { parse_mode: "Markdown" });
  } catch (err) {
    await bot.sendMessage(msg.chat.id, "Gagal membaca log: " + (err.message || err));
  }
});

// checknow
bot.onText(/\/checknow/, async (msg) => {
  await bot.sendMessage(msg.chat.id, "⏳ Menjalankan pengecekan manual...");
  await checkUpbitNewListings();
  const scan = await scanUpbitWallet();
  await bot.sendMessage(msg.chat.id, scan, { parse_mode: "Markdown" });
  await bot.sendMessage(msg.chat.id, "✅ Selesai pengecekan manual.");
});
// scanwallet
bot.onText(/\/scanwallet/, async (msg) => {
  await bot.sendMessage(msg.chat.id, "⏳ Scan transaksi wallet Upbit...");
  const scan = await scanUpbitWallet();
  await bot.sendMessage(msg.chat.id, scan, { parse_mode: "Markdown" });
});

// ----------------------------
// Intervals (auto-check)
// ----------------------------
setInterval(() => checkUpbitNewListings(), 30000); // 30s
// wallet scanning is manual (via /scanwallet) to avoid rate limit / noise

// Startup
log("🔥 Upbit Listing Bot Started...");
console.log("🔥 Upbit Listing Bot Started...");
