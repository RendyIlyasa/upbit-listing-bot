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

// Support multiple wallets (default: 3 Upbit official wallets)
const UPBIT_WALLETS_RAW = process.env.UPBIT_WALLETS || 
    "0xba826fec90cefdf6706858e5fbafcb27a290fbe0,0x5e032243d507c743b061ef021e2ec7fcc6d3ab89,0xc9cf0ec93d764f5c9571fd12f764bae7fc87c84e";
const UPBIT_WALLETS = UPBIT_WALLETS_RAW.split(",").map(w => w.trim()).filter(Boolean);

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

// Track last tx per wallet
let lastWalletTxHash = {};

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
// 2) WALLET TRACKER (Multiple wallets)
// --------------------------------------------------------------------------------
async function checkWallet() {
    if (!ETHERSCAN_API || UPBIT_WALLETS.length === 0) return;

    for (const wallet of UPBIT_WALLETS) {
        try {
            const url = `https://api.etherscan.io/v2/api?chainid=1&module=account&action=tokentx&address=${wallet}&sort=desc&apikey=${ETHERSCAN_API}`;
            const r = await axios.get(url, { timeout: 10000 });
            const result = r.data.result;
            if (!result || result.length === 0 || typeof result === "string")
                continue;

            const tx = result[0];

            // first init
            if (!lastWalletTxHash[wallet]) {
                lastWalletTxHash[wallet] = tx.hash;
                log(`Init wallet ${wallet.slice(0, 10)}: ${tx.hash}`);
                continue;
            }

            // new transaction
            if (tx.hash !== lastWalletTxHash[wallet]) {
                lastWalletTxHash[wallet] = tx.hash;

                const tokenName = tx.tokenName || "UNKNOWN";
                const tokenSymbol = tx.tokenSymbol || "";
                const value = Number(tx.value) / 10 ** (tx.tokenDecimal || 18);
                const walletLabel = wallet === UPBIT_WALLETS[0] ? "Upbit 2 (Hot)" : 
                                   wallet === UPBIT_WALLETS[1] ? "Upbit 3 (Hot)" : "Upbit Cold";

                log(`${walletLabel} received: ${tokenName}`);

                const msg = `🔔 *Upbit Wallet Received Token*

📍 *${walletLabel}*
🪙 *${tokenName}* (${tokenSymbol})
Jumlah: *${value.toLocaleString()}*
Tx: https://etherscan.io/tx/${tx.hash}`;

                await bot.sendMessage(CHAT_ID, msg, { parse_mode: "Markdown" });
            }
        } catch (err) {
            log(`Wallet error (${wallet.slice(0, 10)}): ${err.message}`);
        }
    }
}

// --------------------------------------------------------------------------------
// 3) Manual scan wallet (All 3 wallets aggregated)
// --------------------------------------------------------------------------------
async function scanUpbitWallet() {
    if (!ETHERSCAN_API || UPBIT_WALLETS.length === 0) {
        return "❌ ETHERSCAN_API atau wallets tidak diset.";
    }

    try {
        const tokenMap = {};
        const walletLabels = {
            [UPBIT_WALLETS[0]]: "Upbit 2 (Hot)",
            [UPBIT_WALLETS[1]]: "Upbit 3 (Hot)",
            [UPBIT_WALLETS[2]]: "Upbit Cold"
        };

        // Fetch from all 3 wallets
        for (const wallet of UPBIT_WALLETS) {
            try {
                const url = `https://api.etherscan.io/v2/api?chainid=1&module=account&action=tokentx&address=${wallet}&page=1&offset=50&sort=desc&apikey=${ETHERSCAN_API}`;
                const r = await axios.get(url, { timeout: 10000 });
                const txs = r.data.result;

                if (!txs || txs.length === 0 || typeof txs === "string") continue;

                txs.forEach((tx) => {
                    const symbol = tx.tokenSymbol || "UNKNOWN";
                    const name = tx.tokenName || "Unknown";
                    const amount = Number(tx.value) / (10 ** (tx.tokenDecimal || 18));

                    if (!tokenMap[symbol]) {
                        tokenMap[symbol] = {
                            name,
                            symbol,
                            totalAmount: 0,
                            latestTx: tx.hash,
                            latestWallet: walletLabels[wallet]
                        };
                    }
                    tokenMap[symbol].totalAmount += amount;
                    tokenMap[symbol].latestTx = tx.hash; // Always update to latest
                });
            } catch (err) {
                log(`Scan error for wallet ${wallet.slice(0, 10)}: ${err.message}`);
            }
        }

        if (Object.keys(tokenMap).length === 0) {
            return "Tidak ada transaksi token.";
        }

        // Sort by amount (descending) and get top 10
        const sorted = Object.values(tokenMap)
            .sort((a, b) => b.totalAmount - a.totalAmount)
            .slice(0, 10);

        let output = `📊 *Token Summary - All Upbit Wallets*\n\n`;

        sorted.forEach((token, idx) => {
            output += `${idx + 1}. *${token.symbol}* (${token.name})
   Total: *${token.totalAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })}*
   From: ${token.latestWallet}
   [Tx](https://etherscan.io/tx/${token.latestTx})

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
    await checkUpbitNewListings();
    bot.sendMessage(msg.chat.id, "📌 Done.");
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
