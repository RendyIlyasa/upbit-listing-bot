import express from "express";
const app = express();

app.all("/", (req, res) => {
  res.send("🔥 Upbit Bot is Running");
});

function keepAlive() {
  app.listen(3000, () => {
    console.log("🌐 Server running on port 3000");
  });
}

keepAlive();

import dotenv from "dotenv";
import axios from "axios";
import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ETHERSCAN_API = process.env.ETHERSCAN_API || "";
const UPBIT_WALLET = process.env.UPBIT_WALLET || "";

if (!BOT_TOKEN || !CHAT_ID) {
    console.error("BOT_TOKEN dan CHAT_ID harus diisi pada .env");
    process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { 
    polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10 }
    }
});

bot.on("polling_error", (error) => {
    console.log("Polling error:", error.code);
});

const LOGS_DIR = path.join(__dirname, "logs");

// Create logs directory if not exists
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// In-memory state
let lastWalletTxHash = null;

// util: get today's log file
function getTodayLogFile() {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(LOGS_DIR, `${today}.txt`);
}

// util: logging (auto daily files)
function log(text) {
    const now = new Date();
    const timestamp = now.toISOString();
    const line = `[${timestamp}] ${text}\n`;
    
    // Write to today's log file
    const logFile = getTodayLogFile();
    fs.appendFileSync(logFile, line);
    
    // Also console log
    console.log(line.trim());
}

// ----------------------------
// 1) Upbit New Listing Detector (via Market API)
// ----------------------------
const UPBIT_MARKET_API = "https://api.upbit.com/v1/market/all";
let knownMarkets = new Set();

async function checkUpbitNewListings() {
    try {
        const res = await axios.get(UPBIT_MARKET_API, { 
            timeout: 10000,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json"
            }
        });
        
        const markets = res.data || [];
        if (!markets || markets.length === 0) return;
        
        const currentMarkets = new Set(markets.map(m => m.market));
        
        // Initialize on first run
        if (knownMarkets.size === 0) {
            knownMarkets = currentMarkets;
            log(`Inisialisasi Upbit markets: ${knownMarkets.size} pairs`);
            return;
        }
        
        // Check for new markets
        for (const m of markets) {
            if (!knownMarkets.has(m.market)) {
                const marketName = m.market;
                const koreanName = m.korean_name || "";
                const englishName = m.english_name || "";
                
                log(`🚀 NEW LISTING DETECTED: ${marketName} (${englishName})`);
                
                const msg = `🚀 *UPBIT NEW LISTING DETECTED!*

🪙 *${englishName}* (${koreanName})
📊 Market: \`${marketName}\`
🔗 [Trade on Upbit](https://upbit.com/exchange?code=CRIX.UPBIT.${marketName})

⏰ Detected at: ${new Date().toISOString()}`;
                
                await bot.sendMessage(CHAT_ID, msg, { parse_mode: "Markdown" });
                knownMarkets.add(m.market);
            }
        }
    } catch (err) {
        log("Upbit Market check error: " + (err.message || err));
    }
}

// ----------------------------
// 2) Wallet Tracker (Etherscan V2 API)
// ----------------------------
async function checkWallet() {
    if (!ETHERSCAN_API || !UPBIT_WALLET) return;

    try {
        const url = `https://api.etherscan.io/v2/api?chainid=1&module=account&action=tokentx&address=${UPBIT_WALLET}&sort=desc&apikey=${ETHERSCAN_API}`;
        const res = await axios.get(url, { timeout: 10000 });
        const result = res.data && res.data.result;
        if (!result || result.length === 0 || typeof result === "string") return;

        const tx = result[0];
        if (!lastWalletTxHash) {
            lastWalletTxHash = tx.hash;
            log(`Init wallet lastTx=${lastWalletTxHash}`);
            return;
        }

        if (tx.hash !== lastWalletTxHash) {
            lastWalletTxHash = tx.hash;
            const tokenName = tx.tokenName || tx.contractAddress || "UNKNOWN";
            const tokenSymbol = tx.tokenSymbol || "";
            const value = Number(tx.value) / (10 ** (tx.tokenDecimal || 18));
            const msg = `🔔 *Upbit Wallet Received Token*\n\nToken: *${tokenName}* ${tokenSymbol ? `(${tokenSymbol})` : ""}\nAmount: ${value.toLocaleString()}\nTx: https://etherscan.io/tx/${tx.hash}`;
            log(`Wallet receive: ${tokenName} ${tokenSymbol}`);
            await bot.sendMessage(CHAT_ID, msg, { parse_mode: "Markdown" });
        }
    } catch (err) {
        log("Wallet error: " + (err.message || err));
    }
}

// ----------------------------
// 3) Quick Volume Check (BTC & ETH)
// ----------------------------
async function getQuickVolume() {
    try {
        const res = await axios.get(
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true",
            { timeout: 10000 }
        );

        const btc = res.data.bitcoin;
        const eth = res.data.ethereum;

        return `📊 *Volume & Harga Crypto*

🟠 *Bitcoin (BTC)*
Harga: *$${btc.usd.toLocaleString()}*
Volume 24h: *$${(btc.usd_24h_vol / 1000000000).toFixed(2)}B*
Change 24h: *${btc.usd_24h_change?.toFixed(2) || 0}%*

🔵 *Ethereum (ETH)*
Harga: *$${eth.usd.toLocaleString()}*
Volume 24h: *$${(eth.usd_24h_vol / 1000000000).toFixed(2)}B*
Change 24h: *${eth.usd_24h_change?.toFixed(2) || 0}%*`;
    } catch (err) {
        log("Quick volume error: " + err.message);
        return "⚠️ Gagal mengambil data volume: " + err.message;
    }
}

// ----------------------------
// 4) Scan Wallet Manual
// ----------------------------
async function scanUpbitWallet() {
    if (!ETHERSCAN_API || !UPBIT_WALLET) {
        return "⚠️ ETHERSCAN_API atau UPBIT_WALLET belum diset.";
    }

    try {
        const url = `https://api.etherscan.io/v2/api?chainid=1&module=account&action=tokentx&address=${UPBIT_WALLET}&page=1&offset=10&sort=desc&apikey=${ETHERSCAN_API}`;
        const r = await axios.get(url, { timeout: 10000 });
        const txs = r.data.result;

        if (!txs || txs.length === 0 || typeof txs === "string")
            return `🔍 Tidak ada token yang masuk baru-baru ini.\n\nStatus: ${r.data.message || "OK"}`;

        let text = `🔍 *Token Masuk ke Wallet Upbit*\nAlamat: \`${UPBIT_WALLET.slice(0, 10)}...\`\n\n`;

        txs.slice(0, 5).forEach((tx) => {
            const amount = tx.value / 10 ** tx.tokenDecimal;
            text += `🪙 *${tx.tokenName}* (${tx.tokenSymbol})
Jumlah: *${amount.toLocaleString()}*
Dari: \`${tx.from.slice(0, 10)}...\`
[Lihat Tx](https://etherscan.io/tx/${tx.hash})

`;
        });

        return text;
    } catch (err) {
        log("Scan wallet error: " + err.message);
        return "⚠️ Gagal scan wallet Upbit: " + err.message;
    }
}

// ----------------------------
// Telegram command handlers
// ----------------------------
const menuText = `🔥 *Upbit Listing Detector — Menu*

*Commands:*
/start - Menu utama
/features - Lihat fitur aktif
/logs - Lihat semua log hari ini
/checknow - Jalankan pengecekan manual
/volume - Cek harga & volume BTC/ETH
/scanwallet - Scan wallet Upbit manual
`;

bot.onText(/\/start/, async (msg) => {
    await bot.sendMessage(msg.chat.id, menuText, { parse_mode: "Markdown" });
});

bot.onText(/\/features/, async (msg) => {
    const features = `*Fitur Aktif*
• Upbit new listing detector (real-time)
• Wallet Upbit incoming token tracker
• Quick volume check (BTC/ETH)
• Wallet scan manual
• Auto-check setiap 30 detik`;
    await bot.sendMessage(msg.chat.id, features, { parse_mode: "Markdown" });
});

bot.onText(/\/logs/, async (msg) => {
    try {
        const logFile = getTodayLogFile();
        const today = new Date().toISOString().split('T')[0];
        
        if (!fs.existsSync(logFile)) {
            return bot.sendMessage(msg.chat.id, `📝 Belum ada log untuk hari ini (${today})`);
        }
        
        const data = fs.readFileSync(logFile, "utf8");
        const lines = data.trim();
        
        if (!lines) return bot.sendMessage(msg.chat.id, "Log kosong.");
        
        const msg_text = `📝 *Log Hari Ini (${today})*\n\n\`\`\`\n${lines}\n\`\`\``;
        await bot.sendMessage(msg.chat.id, msg_text, { parse_mode: "Markdown" });
    } catch (err) {
        await bot.sendMessage(msg.chat.id, "Gagal membaca log: " + (err.message || err));
    }
});

bot.onText(/\/checknow/, async (msg) => {
    await bot.sendMessage(msg.chat.id, "⏳ Menjalankan pengecekan manual...");
    await checkUpbitNewListings();
    await checkWallet();
    await bot.sendMessage(msg.chat.id, "✅ Selesai pengecekan manual.");
});

bot.onText(/\/volume/, async (msg) => {
    await bot.sendMessage(msg.chat.id, "⏳ Mengambil data volume...");
    const v = await getQuickVolume();
    await bot.sendMessage(msg.chat.id, v, { parse_mode: "Markdown" });
});

bot.onText(/\/scanwallet/, async (msg) => {
    await bot.sendMessage(msg.chat.id, "⏳ Scan transaksi wallet Upbit...");
    const scan = await scanUpbitWallet();
    await bot.sendMessage(msg.chat.id, scan, { parse_mode: "Markdown" });
});

// ----------------------------
// Auto-check intervals
// ----------------------------
setInterval(() => {
    checkUpbitNewListings();
}, 30000); // 30 detik

setInterval(() => {
    checkWallet();
}, 30000); // 30 detik

// Startup
log("🔥 Upbit Listing Bot Started...");
console.log("🔥 Upbit Listing Bot Started...");
console.log("Commands: /start, /features, /logs, /checknow, /volume, /scanwallet");
