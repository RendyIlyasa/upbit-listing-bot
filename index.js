import express from "express";
const app = express();

app.all("/", (req, res) => {
  res.send("🔥 Upbit Bot is Running (Replit KeepAlive)");
});

function keepAlive() {
  app.listen(3000, () => {
    console.log("🌐 KeepAlive server running on port 3000");
  });
}

keepAlive();

import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";
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
const WATCH_TOKENS_RAW = process.env.WATCH_TOKENS || "";

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

const LOG_FILE = path.join(__dirname, "logs.txt");

// In-memory state
let lastNoticeId = null;
let lastWalletTxHash = null;
let lastVolumeSnapshot = {};
let alerts = [];
let watchTokens = WATCH_TOKENS_RAW.split(",").map(s => s.trim()).filter(Boolean);

// util: logging
function log(text) {
    const line = `[${new Date().toISOString()}] ${text}\n`;
    fs.appendFileSync(LOG_FILE, line);
    console.log(line.trim());
}

// util: add alert (store in-memory + log)
function addAlert(type, title, detail) {
    const a = { type, title, detail, ts: new Date().toISOString() };
    alerts.unshift(a);
    if (alerts.length > 200) alerts.pop();
    log(`ALERT ${type}: ${title} - ${detail}`);
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
                addAlert("upbit_listing", `${marketName} - ${englishName}`, koreanName);
                
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
            addAlert("wallet_receive", `${tokenName} ${tokenSymbol}`, `Tx: ${tx.hash}`);
            await bot.sendMessage(CHAT_ID, msg, { parse_mode: "Markdown" });
        }
    } catch (err) {
        log("Wallet error: " + (err.message || err));
    }
}

// ----------------------------
// 3) Volume checker (CoinGecko)
// ----------------------------
async function fetchVolumeCoinGecko(contractAddress) {
    try {
        const url = `https://api.coingecko.com/api/v3/coins/ethereum/contract/${contractAddress}`;
        const res = await axios.get(url, { timeout: 10000 });
        const volUsd = res.data?.market_data?.total_volume?.usd;
        const name = res.data?.name;
        const symbol = res.data?.symbol;
        return { volUsd: volUsd || 0, name: name || contractAddress, symbol: symbol || "" };
    } catch (err) {
        return null;
    }
}

async function checkVolumes() {
    if (watchTokens.length === 0) return;
    for (const contract of watchTokens) {
        try {
            const info = await fetchVolumeCoinGecko(contract);
            if (!info) {
                log(`CoinGecko: token not found or error for ${contract}`);
                continue;
            }
            const key = contract.toLowerCase();
            const vol = Number(info.volUsd || 0);

            if (!lastVolumeSnapshot[key]) {
                lastVolumeSnapshot[key] = vol;
                continue;
            }

            if (vol > lastVolumeSnapshot[key] * 1.5 && vol > 1000) {
                const title = `Volume spike ${info.name} (${info.symbol.toUpperCase()})`;
                const detail = `24h_volume_usd=${vol.toFixed(2)} (prev=${lastVolumeSnapshot[key].toFixed(2)})`;
                addAlert("volume_spike", title, detail);
                await bot.sendMessage(CHAT_ID, `📈 *VOLUME SPIKE*\n${title}\n${detail}`, { parse_mode: "Markdown" });
            }

            lastVolumeSnapshot[key] = vol;
        } catch (err) {
            log(`Volume check error for ${contract}: ${err.message || err}`);
        }
    }
}

// ----------------------------
// 4) Quick Volume Check (BTC & ETH)
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
// 5) Scan Wallet Manual
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
/alerts - Lihat list alert terbaru
/logs - Ambil 50 baris terakhir logs
/listtokens - Lihat token yang dipantau
/addtoken <contract> - Tambah token
/removetoken <contract> - Hapus token
/checknow - Jalankan pengecekan manual
/volume - Cek harga & volume BTC/ETH
/scanwallet - Scan wallet Upbit manual
`;

bot.onText(/\/start/, async (msg) => {
    await bot.sendMessage(msg.chat.id, menuText, { parse_mode: "Markdown" });
});

bot.onText(/\/features/, async (msg) => {
    const features = `*Fitur Aktif*
• Upbit notice scraping (auto detect listing)
• Wallet Upbit incoming token tracker
• Volume check via CoinGecko
• Token watchlist management
• Alerts & logs (/alerts dan /logs)
• Auto-check setiap 30 detik`;
    await bot.sendMessage(msg.chat.id, features, { parse_mode: "Markdown" });
});

bot.onText(/\/alerts/, async (msg) => {
    if (alerts.length === 0) return bot.sendMessage(msg.chat.id, "Belum ada alerts tersimpan.");
    const lines = alerts.slice(0, 20).map(a => `• [${a.type}] ${a.title}\n  ${a.detail}\n  ${a.ts}`).join("\n\n");
    await bot.sendMessage(msg.chat.id, `📋 *Recent Alerts*\n\n${lines}`, { parse_mode: "Markdown" });
});

bot.onText(/\/logs/, async (msg) => {
    try {
        const data = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, "utf8") : "";
        const lines = data.trim().split("\n").slice(-30).join("\n");
        if (!lines) return bot.sendMessage(msg.chat.id, "Log kosong.");
        await bot.sendMessage(msg.chat.id, `\`\`\`\n${lines}\n\`\`\``, { parse_mode: "Markdown" });
    } catch (err) {
        await bot.sendMessage(msg.chat.id, "Gagal membaca log: " + (err.message || err));
    }
});

bot.onText(/\/listtokens/, async (msg) => {
    if (watchTokens.length === 0) return bot.sendMessage(msg.chat.id, "Belum ada token yang dipantau.\nTambah dengan /addtoken <contract>");
    const out = watchTokens.map((c, i) => `${i+1}. \`${c}\``).join("\n");
    await bot.sendMessage(msg.chat.id, `📌 *Watch Tokens*\n${out}`, { parse_mode: "Markdown" });
});

bot.onText(/\/addtoken (.+)/, async (msg, match) => {
    const contract = (match[1] || "").trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(contract)) {
        return bot.sendMessage(msg.chat.id, "Format contract invalid. Pastikan contract address Ethereum lengkap (0x...).");
    }
    if (!watchTokens.includes(contract)) {
        watchTokens.push(contract);
        addAlert("watch_add", "Added watch token", contract);
        await bot.sendMessage(msg.chat.id, `✅ Token ditambahkan: \`${contract}\``, { parse_mode: "Markdown" });
    } else {
        await bot.sendMessage(msg.chat.id, "Token sudah ada di watchlist.");
    }
});

bot.onText(/\/removetoken (.+)/, async (msg, match) => {
    const contract = (match[1] || "").trim();
    const idx = watchTokens.indexOf(contract);
    if (idx === -1) return bot.sendMessage(msg.chat.id, "Token tidak ditemukan di watchlist.");
    watchTokens.splice(idx, 1);
    addAlert("watch_remove", "Removed watch token", contract);
    await bot.sendMessage(msg.chat.id, `🗑️ Dihapus: \`${contract}\``, { parse_mode: "Markdown" });
});

bot.onText(/\/checknow/, async (msg) => {
    await bot.sendMessage(msg.chat.id, "⏳ Menjalankan pengecekan manual...");
    await checkUpbitNewListings();
    await checkWallet();
    await checkVolumes();
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

setInterval(() => {
    checkVolumes();
}, 60000); // 60 detik

// Startup
log("🔥 Enhanced Upbit Bot Started...");
console.log("🔥 Enhanced Upbit Bot Started...");
console.log("Commands: /start, /features, /alerts, /logs, /listtokens, /addtoken, /removetoken, /checknow, /volume, /scanwallet");
