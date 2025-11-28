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

// Support single wallet from env (default: Upbit 2 Hot wallet - most active)
const UPBIT_WALLET = process.env.UPBIT_WALLET || "0xba826fec90cefdf6706858e5fbafcb27a290fbe0";

if (!BOT_TOKEN || !CHAT_ID) {
    console.error("BOT_TOKEN dan CHAT_ID harus diisi pada .env");
    process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, {
    polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10 },
    },
});

bot.on("polling_error", (error) => {
    console.log("Polling error:", error.code);
});

const LOGS_DIR = path.join(__dirname, "logs");
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Track last tx
let lastWalletTxHash = null;

// util log harian
function getTodayLogFile() {
    const today = new Date().toISOString().split("T")[0];
    return path.join(LOGS_DIR, `${today}.txt`);
}

function log(text) {
    const now = new Date();
    const timestamp = now.toISOString();
    const msg = `[${timestamp}] ${text}\n`;
    const logFile = getTodayLogFile();

    fs.appendFileSync(logFile, msg);
    console.log(msg.trim());
}

// --------------------------------------------------------------------------------
// 1) NEW LISTING DETECTOR
// --------------------------------------------------------------------------------
const UPBIT_MARKET_API = "https://api.upbit.com/v1/market/all";
let knownMarkets = new Set();

async function checkUpbitNewListings() {
    try {
        const res = await axios.get(UPBIT_MARKET_API, { timeout: 10000 });
        const markets = res.data || [];
        if (!markets || markets.length === 0) return;

        const currentMarkets = new Set(markets.map((m) => m.market));

        // first run
        if (knownMarkets.size === 0) {
            knownMarkets = currentMarkets;
            log(`Inisialisasi Upbit markets: ${knownMarkets.size} pairs`);
            return;
        }

        for (const m of markets) {
            if (!knownMarkets.has(m.market)) {
                const marketName = m.market;
                const englishName = m.english_name || "";
                const koreanName = m.korean_name || "";

                log(`NEW LISTING DETECTED: ${marketName}`);

                const msg = `🚀 *UPBIT NEW LISTING DETECTED!*

🪙 *${englishName}* (${koreanName})
📊 Pasangan: \`${marketName}\`
🔗 https://upbit.com/exchange?code=CRIX.UPBIT.${marketName}`;

                await bot.sendMessage(CHAT_ID, msg, { parse_mode: "Markdown" });
                knownMarkets.add(m.market);
            }
        }
    } catch (err) {
        log("Upbit Market error: " + err.message);
    }
}

// --------------------------------------------------------------------------------
// 2) WALLET TRACKER
// --------------------------------------------------------------------------------
async function checkWallet() {
    if (!ETHERSCAN_API || !UPBIT_WALLET) return;

    try {
        const url = `https://api.etherscan.io/v2/api?chainid=1&module=account&action=tokentx&address=${UPBIT_WALLET}&sort=desc&apikey=${ETHERSCAN_API}`;
        const r = await axios.get(url, { timeout: 10000 });
        const result = r.data.result;
        if (!result || result.length === 0 || typeof result === "string")
            return;

        const tx = result[0];

        // first init
        if (!lastWalletTxHash) {
            lastWalletTxHash = tx.hash;
            log(`Init wallet ${UPBIT_WALLET.slice(0, 10)}: ${tx.hash}`);
            return;
        }

        // new transaction
        if (tx.hash !== lastWalletTxHash) {
            lastWalletTxHash = tx.hash;

            const tokenName = tx.tokenName || "UNKNOWN";
            const tokenSymbol = tx.tokenSymbol || "";
            const value = Number(tx.value) / 10 ** (tx.tokenDecimal || 18);

            log(`Wallet received: ${tokenName}`);

            const msg = `🔔 *Upbit Wallet Received Token*

🪙 *${tokenName}* (${tokenSymbol})
Jumlah: *${value.toLocaleString()}*
Tx: https://etherscan.io/tx/${tx.hash}`;

            await bot.sendMessage(CHAT_ID, msg, { parse_mode: "Markdown" });
        }
    } catch (err) {
        log("Wallet error: " + err.message);
    }
}

// --------------------------------------------------------------------------------
// 3) Manual scan wallet
// --------------------------------------------------------------------------------
async function scanUpbitWallet() {
    if (!ETHERSCAN_API || !UPBIT_WALLET) {
        return "❌ ETHERSCAN_API atau UPBIT_WALLET tidak diset.";
    }

    try {
        const url = `https://api.etherscan.io/v2/api?chainid=1&module=account&action=tokentx&address=${UPBIT_WALLET}&page=1&offset=10&sort=desc&apikey=${ETHERSCAN_API}`;
        const r = await axios.get(url, { timeout: 10000 });
        const txs = r.data.result;

        if (!txs || typeof txs === "string" || txs.length === 0) {
            return "Tidak ada data transaksi.";
        }

        let output = `🔍 *Scan Wallet Upbit*\n\n`;

        txs.slice(0, 5).forEach((tx) => {
            const value = tx.value / 10 ** tx.tokenDecimal;
            output += `🪙 *${tx.tokenName}* (${tx.tokenSymbol})
Jumlah: *${value.toLocaleString()}*
Tx: https://etherscan.io/tx/${tx.hash}

`;
        });

        return output;
    } catch (err) {
        return "❌ Gagal scan wallet: " + err.message;
    }
}

// --------------------------------------------------------------------------------
// Menu Telegram
// --------------------------------------------------------------------------------
const menuText = `🔥 *Upbit Listing Bot — Menu*
/start - Menu
/features - Fitur aktif
/logs - Log hari ini
/checknow - Cek semua fitur manual
/checklisting - Cek listing Upbit manual
/scanwallet - Scan wallet Upbit`;

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, menuText, { parse_mode: "Markdown" });
});

bot.onText(/\/features/, (msg) => {
    bot.sendMessage(
        msg.chat.id,
        `*Fitur Aktif*
• Upbit new listing detector
• Wallet Upbit tracker
• Scan wallet manual
• Auto-check tiap 30 detik`,
        { parse_mode: "Markdown" },
    );
});

bot.onText(/\/logs/, (msg) => {
    try {
        const logFile = getTodayLogFile();
        const today = new Date().toISOString().split("T")[0];

        if (!fs.existsSync(logFile))
            return bot.sendMessage(msg.chat.id, "Belum ada log hari ini.");

        let data = fs.readFileSync(logFile, "utf8");
        if (!data.trim()) return bot.sendMessage(msg.chat.id, "Log kosong.");

        const text = `📝 *Log Hari Ini (${today})*\n\n\`\`\`\n${data}\n\`\`\``;
        bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
    } catch (err) {
        bot.sendMessage(msg.chat.id, "Gagal membaca log.");
    }
});

// cek semua fitur
bot.onText(/\/checknow/, async (msg) => {
    await bot.sendMessage(msg.chat.id, "⏳ Menjalankan pengecekan...");
    await checkUpbitNewListings();
    await checkWallet();
    bot.sendMessage(msg.chat.id, "✅ Selesai.");
});

// cek listing manual
bot.onText(/\/checklisting/, async (msg) => {
    await bot.sendMessage(msg.chat.id, "⏳ Mengecek listing baru di Upbit...");
    try {
        const res = await axios.get(UPBIT_MARKET_API, { timeout: 10000 });
        const markets = res.data || [];
        
        if (!markets || markets.length === 0) {
            return bot.sendMessage(msg.chat.id, "❌ Gagal mengambil data Upbit.");
        }

        const currentMarkets = new Set(markets.map((m) => m.market));
        const newListings = [];

        for (const m of markets) {
            if (!knownMarkets.has(m.market)) {
                newListings.push(m);
                knownMarkets.add(m.market);
            }
        }

        if (newListings.length === 0) {
            return bot.sendMessage(msg.chat.id, "✅ Tidak ada listing baru. Total pairs: " + markets.length);
        }

        let output = `🚀 *LISTING BARU DITEMUKAN!* (${newListings.length} coins)\n\n`;
        newListings.slice(0, 10).forEach((m, idx) => {
            output += `${idx + 1}. *${m.english_name}* (${m.korean_name})\n   \`${m.market}\`\n\n`;
        });

        bot.sendMessage(msg.chat.id, output, { parse_mode: "Markdown" });
    } catch (err) {
        bot.sendMessage(msg.chat.id, "❌ Gagal cek listing: " + err.message);
    }
});

// scan wallet manual
bot.onText(/\/scanwallet/, async (msg) => {
    const text = await scanUpbitWallet();
    bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// --------------------------------------------------------------------------------
// AUTO CHECK
// --------------------------------------------------------------------------------
setInterval(checkUpbitNewListings, 30000);
setInterval(checkWallet, 30000);

log("🔥 Upbit Listing Bot Started...");
console.log("🔥 Upbit Listing Bot Started...");
