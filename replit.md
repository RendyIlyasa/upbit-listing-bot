# Upbit Listing Detector Bot

## Overview
Enhanced Telegram bot untuk mendeteksi potensi listing Upbit dengan fitur lengkap:
- Upbit new listing detector (real-time market monitoring)
- Wallet tracker (Etherscan V2 API)
- Volume checker (CoinGecko)
- Token watchlist management
- Alerts & logs system

## Recent Changes
- November 26, 2025: Fixed Upbit API integration
  - Changed from notice scraping to market list API (no more 403 errors)
  - Now detects new listings by monitoring Upbit market pairs
  - Bot berjalan 24/7 dengan polling bot Telegram

## Project Architecture
- `index.js` - Main bot file dengan semua fitur
- `logs.txt` - Log file (auto-generated)

## Environment Variables Required
- `BOT_TOKEN` - Telegram Bot API token
- `CHAT_ID` - Telegram chat ID
- `ETHERSCAN_API` - Etherscan API key
- `UPBIT_WALLET` - Upbit wallet address
- `WATCH_TOKENS` - (Optional) Comma-separated contract addresses

## Tech Stack
- Node.js 20 (ES Modules)
- node-telegram-bot-api (polling method - berjalan 24/7)
- axios
- cheerio (for HTML parsing)
- dotenv

## Bot Commands
| Command | Fungsi |
|---------|--------|
| `/start` | Menu utama |
| `/features` | Lihat fitur aktif |
| `/alerts` | Lihat alert terbaru |
| `/logs` | Lihat 30 baris log terakhir |
| `/listtokens` | Lihat token yang dipantau |
| `/addtoken <contract>` | Tambah token ke watchlist |
| `/removetoken <contract>` | Hapus token dari watchlist |
| `/checknow` | Pengecekan manual |
| `/volume` | Cek harga & volume BTC/ETH |
| `/scanwallet` | Scan wallet Upbit manual |

## Auto-Check Intervals (Background)
- New Listing Detection: 30 detik
- Wallet Tracking: 30 detik
- Token Volume Check: 60 detik

## API Endpoints
- Upbit Market: `https://api.upbit.com/v1/market/all`
- CoinGecko: `https://api.coingecko.com/api/v3/`
- Etherscan V2: `https://api.etherscan.io/v2/api?chainid=1`

## Deployment ke Railway (Gratis 24/7)

### Persiapan
1. Buat GitHub account di github.com
2. Create repository baru dengan nama `upbit-listing-bot`
3. Push kode Replit ke GitHub (lihat RAILWAY_SETUP_SIMPLE.txt untuk langkah detail)

### Deploy ke Railway
1. Pergi ke railway.app
2. Click "Start a New Project"
3. Pilih "Deploy from GitHub"
4. Authorize dan pilih repository upbit-listing-bot
5. Tambah Environment Variables (BOT_TOKEN, CHAT_ID, ETHERSCAN_API, UPBIT_WALLET)
6. Click "Deploy"
7. Bot langsung berjalan 24/7 gratis! 🎉

### Benefit Railway
✅ Gratis $5/bulan (cukup untuk bot selamanya)
✅ Always-on 24/7
✅ Auto restart kalau crash
✅ Real-time logs untuk monitoring
✅ Mudah update (push ke GitHub, auto-deploy)
