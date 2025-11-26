# Deploy Bot ke Railway.app (Gratis 24/7)

## Keuntungan Railway
✅ Gratis $5/bulan (lebih dari cukup untuk bot)
✅ Always-on 24/7
✅ Auto restart kalau crash
✅ Mudah setup

---

## Step 1: Setup GitHub Repository

### 1a. Buka GitHub (github.com) dan login
- Jika belum punya akun, buat account baru gratis

### 1b. Create New Repository
- Click "New" atau pergi ke https://github.com/new
- Repository name: `upbit-listing-bot` (atau nama lain)
- Pilih **Public** atau **Private**
- Click "Create repository"

### 1c. Push Kode dari Replit ke GitHub
Di terminal Replit, jalankan perintah ini (ganti USERNAME dan TOKEN):

```bash
# Setup git
git config --global user.name "Your Name"
git config --global user.email "your@email.com"

# Add all files
git add .

# Commit
git commit -m "Initial commit: Upbit Listing Bot"

# Push ke GitHub
git remote add origin https://github.com/USERNAME/upbit-listing-bot.git
git branch -M main
git push -u origin main
```

**Atau gunakan GitHub Desktop:**
1. Download GitHub Desktop
2. Clone repo kosong kamu
3. Copy semua file Replit ke folder tersebut
4. Commit & Push

---

## Step 2: Deploy ke Railway

### 2a. Pergi ke railway.app
- https://railway.app
- Click "Start a New Project"
- Login dengan GitHub account kamu

### 2b. Connect GitHub
- Pilih "Deploy from GitHub"
- Authorize Railway untuk akses GitHub
- Pilih repository `upbit-listing-bot`

### 2c. Configure Environment Variables
Railway akan menampilkan form untuk env vars. Isi dengan:

```
BOT_TOKEN=your_bot_token_here
CHAT_ID=your_chat_id_here
ETHERSCAN_API=your_etherscan_key_here
UPBIT_WALLET=0x...your_wallet_here
WATCH_TOKENS=0x...,0x...(optional)
```

Kamu bisa copy-paste dari Replit Secrets

### 2d. Deploy
- Click "Deploy"
- Railway akan auto-build dan run bot
- Bot langsung 24/7! 🎉

---

## Step 3: Monitor Bot

Di Railway dashboard:
- Bisa lihat logs real-time
- Restart button kalau perlu
- View deployment status

---

## Troubleshooting

### Bot tidak jalan?
1. Cek "Logs" tab di Railway - lihat error message
2. Pastikan BOT_TOKEN dan CHAT_ID benar
3. Restart deployment

### Butuh update kode?
1. Edit di Replit
2. Push ke GitHub: `git add . && git commit -m "Fix X" && git push`
3. Railway auto-deploy, tunggu sebentar

---

## Tips
- Railway gratis $5/bulan, cukup untuk bot selamanya
- Kalau butuh upgrade: bayar sesuai usage (metered)
- Bot akan tetap online kalau Railway server down (mereka very reliable)

Good luck! 🚀
