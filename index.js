const { Telegraf } = require('telegraf');
const fetch = require('node-fetch');
const axios = require('axios');
const fs = require('fs');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestWaWebVersion } = require('@whiskeysockets/baileys');

// ==========================
// KONFIGURASI DASAR
// ==========================
const BOT_TOKEN = '7580765545:AAE_CcySFM8u1xzbqn23c6zali9-AFJUJ2E';
const API_KEY = 'BALMOND';
const BASE_URL = 'https://web-privatev1.vercel.app/api';
const ADMIN_ID = 8292786652;
const SESSION_NAME = './sessions'; // folder penyimpanan data WA
const bot = new Telegraf(BOT_TOKEN);

let waClient = null;
let waConnectionStatus = 'closed';
const userCooldowns = {}; // { userId: timestamp_end_cooldown }

// ==========================
// HELPER FUNCTION UMUM
// ==========================

function formatResult(data) {
  let out = '📨 *Hasil API:*\n';
  if (data.success !== undefined)
    out += `• Status: ${data.success ? '✅ Berhasil' : '❌ Gagal'}\n`;
  if (data.message) out += `• Pesan: ${data.message}\n`;
  if (data.nomor) out += `• Nomor: ${data.nomor}\n`;
  if (data.email) out += `• Email: ${data.email}\n`;
  if (data.subject) out += `• Subjek: ${data.subject}\n`;
  if (data.response) out += `• Respon: ${data.response}\n`;
  return out;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ==========================
// FITUR PREMIUM USER
// ==========================
const premiumFile = './premium.json';
let premiumUsers = fs.existsSync(premiumFile)
  ? JSON.parse(fs.readFileSync(premiumFile))
  : [];

function savePremium() {
  fs.writeFileSync(premiumFile, JSON.stringify(premiumUsers, null, 2));
}

function isPremium(id) {
  return premiumUsers.includes(id);
}

// GANTI ID ADMIN DENGAN ID KAMU SENDIRI

// ➕ ADDPREM
bot.command('addprem', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply('❌ Hanya admin yang bisa menambah premium.');
  let targetId = ctx.message.reply_to_message
    ? ctx.message.reply_to_message.from.id
    : parseInt(ctx.message.text.split(' ')[1]);
  if (!targetId) return ctx.reply('❌ Gunakan: /addprem <id> atau reply pesan user.');
  if (!premiumUsers.includes(targetId)) {
    premiumUsers.push(targetId);
    savePremium();
    ctx.reply(`✅ User ${targetId} ditambahkan ke daftar premium.`);
  } else ctx.reply('⚠️ User sudah premium.');
});

// ➖ DELPREM
bot.command('delprem', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply('❌ Hanya admin yang bisa menghapus premium.');
  let targetId = ctx.message.reply_to_message
    ? ctx.message.reply_to_message.from.id
    : parseInt(ctx.message.text.split(' ')[1]);
  if (!targetId) return ctx.reply('❌ Gunakan: /delprem <id> atau reply pesan user.');
  if (premiumUsers.includes(targetId)) {
    premiumUsers = premiumUsers.filter(id => id !== targetId);
    savePremium();
    ctx.reply(`✅ User ${targetId} dihapus dari daftar premium.`);
  } else ctx.reply('⚠️ User tidak ada di daftar premium.');
});

// 📜 LISTPREM
bot.command('listprem', async (ctx) => {
  if (!premiumUsers.length) return ctx.reply('📭 Belum ada user premium.');
  const list = premiumUsers.map((id, i) => `${i + 1}. ${id}`).join('\n');
  ctx.reply(`💎 *Daftar Premium:*\n${list}`, { parse_mode: 'Markdown' });
});

// ==========================
// PROTEKSI PREMIUM UNTUK FITUR LAIN
// ==========================

// Middleware global (cek semua command selain /start dan fitur admin)
// Middleware global (cek semua command selain /start dan fitur admin)
bot.use(async (ctx, next) => {
  const isAdmin = ctx.from?.id === ADMIN_ID;
  const message = ctx.message?.text || "";
  const command = message.split(' ')[0].toLowerCase();

  // command bebas: start & admin
  const allowed = ['/start', '/addprem', '/delprem', '/listprem'];

  if (ctx.updateType === 'message' && command.startsWith('/')) {
    if (!allowed.includes(command) && !isAdmin && !isPremium(ctx.from.id)) {
      return ctx.reply('❌ Fitur ini hanya untuk user premium.\nHubungi admin untuk akses premium.');
    }
  }

  await next();
});
// ==========================
// WHATSAPP CLIENT (BAILEYS)
// ==========================
// ==========================
// WHATSAPP CLIENT (BAILEYS)
// ==========================

async function startWhatsAppClient() {
  console.log("🚀 Memulai koneksi WhatsApp...");

  // Ambil data sesi
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_NAME);

  // Ambil versi terbaru WhatsApp Web
  const { version, isLatest } = await fetchLatestWaWebVersion();
  console.log(`📦 Versi WA Web: ${version.join('.')} (Latest: ${isLatest})`);

  // Buat koneksi WA
  waClient = makeWASocket({
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    version,
    browser: ["Ubuntu", "Chrome", "20.0.00"]
  });

  // Simpan kredensial otomatis
  waClient.ev.on('creds.update', saveCreds);

  // Cek status koneksi
  waClient.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    waConnectionStatus = connection;

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      console.log(`❌ Koneksi WA terputus. Reason: ${reason}`);

      if (shouldReconnect) {
        console.log("🔄 Reconnecting dalam 5 detik...");
        setTimeout(startWhatsAppClient, 5000);
      } else {
        console.log("🛑 Session logout. Hapus folder sessions untuk pairing ulang.");
        waClient = null;
      }

    } else if (connection === 'open') {
      console.log("✅ Berhasil tersambung ke WhatsApp!");
    }
  });
}

// Jalankan
startWhatsAppClient();

// ===========================
// HANDLE CEK BIO (FIXED)
// ===========================
async function handleBioCheck(ctx, numbersToCheck) {
  if (waConnectionStatus !== 'open')
    return ctx.reply("⚠️ WA belum konek, tunggu beberapa detik dan coba lagi.");

  if (!numbersToCheck.length)
    return ctx.reply("❌ Nomor tidak ditemukan.");

  await ctx.reply(`🔍 Mengecek ${numbersToCheck.length} nomor...`);

  let withBio = [];
  let noBio = [];
  let notRegistered = [];

  const jids = numbersToCheck.map(n => n.trim() + '@s.whatsapp.net');
  const exists = await waClient.onWhatsApp(...jids);

  const valid = [];
  exists.forEach(r => {
    const num = r.jid.split('@')[0];
    if (r.exists) valid.push(num);
    else notRegistered.push(num);
  });

  for (let i = 0; i < valid.length; i += 15) {
    const batch = valid.slice(i, i + 15);

    await Promise.allSettled(batch.map(async (num) => {
      try {
        const jid = num + '@s.whatsapp.net';
        const res = await waClient.fetchStatus(jid);

        let bio = null;
        let setAt = null;

        if (Array.isArray(res) && res[0]) {
          const d = res[0];
          bio = typeof d.status === 'string'
            ? d.status
            : d.status?.text || null;
          setAt = d.setAt || d.status?.setAt;
        }

        if (bio && bio.trim()) {
          withBio.push({ nomor: num, bio, date: setAt });
        } else {
          noBio.push(num);
        }
      } catch {
        notRegistered.push(num);
      }
    }));

    await sleep(500);
  }

  // =========================
  // SUMMARY
  // =========================
  await ctx.reply(
    `✅ *SELESAI*\n\n` +
    `📊 Total dicek: ${numbersToCheck.length}\n` +
    `🟢 Dengan bio: ${withBio.length}\n` +
    `🟡 Tanpa bio: ${noBio.length}\n` +
    `🔴 Tidak terdaftar: ${notRegistered.length}`,
    { parse_mode: 'Markdown' }
  );

  // =========================
  // WITH BIO → CHAT (COPYABLE)
  // =========================
  if (withBio.length) {
    let text = '*🟢 NOMOR DENGAN BIO*\n\n';

    withBio.forEach(v => {
      const date = v.date
        ? new Date(v.date).toLocaleString('id-ID')
        : '-';
      text += `${v.nomor}\nBio: ${v.bio}\nDate: ${date}\n\n`;
    });

    const chunks = text.match(/[\s\S]{1,3500}/g);
    for (const c of chunks) {
      await ctx.reply(c, { parse_mode: 'Markdown' });
    }
  }

  // =========================
  // NO BIO → FILE TXT
  // =========================
  if (noBio.length) {
    const filePath = `./tanpa_bio_${ctx.from.id}.txt`;
    const content =
      `HASIL NOMOR TANPA BIO\n` +
      `Total: ${noBio.length}\n\n` +
      noBio.join('\n');

    fs.writeFileSync(filePath, content);
    await ctx.replyWithDocument(
      { source: filePath },
      { caption: '📄 Nomor WhatsApp TANPA BIO' }
    );
    fs.unlinkSync(filePath);
  }
}

// Helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===========================
// BOT LISTENER UNTUK FILE
// ===========================


// ===========================
// COMMAND UNTUK CEK NOMOR LANGSUNG
// ===========================

// ==========================
//  COMMANDS TELEGRAM
// ==========================
bot.command('pairing', async (ctx) => {
  const phoneNumber = ctx.message.text.split(' ')[1]?.replace(/[^0-9]/g, '');
  if (!phoneNumber)
    return ctx.reply("❌ Format salah!\nGunakan: `/pairing 628xxxx`", { parse_mode: 'Markdown' });
  if (!waClient)
    return ctx.reply("⚠️ Koneksi WA belum siap, tunggu bentar bos.");

  try {
    await ctx.reply("Otw minta kode pairing...");
    const code = await waClient.requestPairingCode(phoneNumber);
    await ctx.reply(`📲 Nih kodenya bos: *${code}*\n\nMasukin di WA kamu:\n*Tautkan Perangkat > Tautkan dengan nomor telepon*`,
      { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e);
    ctx.reply("❌ Gagal minta kode pairing, coba lagi nanti.");
  }
});

bot.command('cek', async (ctx) => {
  const nums = ctx.message.text.split(' ').slice(1).join(' ').match(/\d+/g) || [];
  await handleBioCheck(ctx, nums);
});


bot.on('document', async (ctx) => {
  const doc = ctx.message.document;
  const allowedTypes = ['text/plain', 'text/csv']; // Bisa ditambah

  if (!allowedTypes.includes(doc.mime_type)) {
    return ctx.reply("Filenya harus format .txt atau .csv ya bos!");
  }

  try {
    // Ambil link file dari Telegram
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);

    // Ambil konten file sebagai arraybuffer (menghindari encoding error)
    const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });

    // Ubah buffer menjadi string (UTF-8)
    const data = Buffer.from(response.data, 'binary').toString('utf-8');

    // Ambil semua nomor dari file (hanya digit)
    const numbers = data.match(/\d+/g) || [];
    if (numbers.length === 0) return ctx.reply("❌ Tidak ditemukan nomor di file.");

    // Jalankan pengecekan bio otomatis
    await handleBioCheck(ctx, numbers);

  } catch (err) {
    console.error(err);
    ctx.reply("❌ Gagal membaca file, coba lagi bos.");
  }
});

// Helper: panggil API
async function callApi(endpoint, params = {}) {
  const url = new URL(BASE_URL + endpoint);
  params.apikey = API_KEY;
  Object.keys(params).forEach(k => url.searchParams.append(k, params[k]));
  const res = await fetch(url.toString());
  return res.json();
}

function startCooldown(ctx, userId, seconds = 200) {
  userCooldowns[userId] = Date.now() + seconds * 1000;
  let elapsed = 0;

  ctx.reply(
    `⏳ *Cooldown Dimulai!*\nProgress: 0/${seconds}`,
    { parse_mode: 'Markdown' }
  ).then(message => {
    const interval = setInterval(async () => {
      elapsed++;
      const remaining = seconds - elapsed;
      const percent = Math.floor((elapsed / seconds) * 100);
      const filledBlocks = Math.floor((elapsed / seconds) * 20);
      const bar = '█'.repeat(filledBlocks) + '░'.repeat(20 - filledBlocks);

      try {
        if (remaining > 0) {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            message.message_id,
            undefined,
            `⏳ *Cooldown Berjalan...*\n[${bar}] ${elapsed}/${seconds}s (${percent}%)`,
            { parse_mode: 'Markdown' }
          );
        } else {
          clearInterval(interval);

          // Format waktu selesai
          const selesai = new Date();
          const jam = selesai.toLocaleTimeString('id-ID', { hour12: false });
          const tanggal = selesai.toLocaleDateString('id-ID', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
          });

          // Ganti jadi "sertifikat selesai"
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            message.message_id,
            undefined,
            `🏅 *SERTIFIKAT COOLDOWN SELESAI*\n────────────────────\n` +
              `📆 *Tanggal:* ${tanggal}\n` +
              `🕒 *Waktu:* ${jam}\n` +
              `📊 *Status:* ✅ Selesai (${seconds}s)\n\n` +
              `💠 *Done by:* _RizkyMaxz × Jojork_`,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '📲 Kirim Nomor Lagi', callback_data: 'banding' }],
                  [{ text: '🏠 Dashboard', callback_data: 'menu' }]
                ]
              }
            }
          );
        }
      } catch (err) {
        clearInterval(interval);
        console.error('Cooldown update error:', err.message);
      }
    }, 1000);
  });
}

// ==========================
// DASHBOARD MENU KOMBINASI
// ==========================
function dashboardText() {
  return (
    '🏠 *Dashboard Bot Checker WA*\n' +
    '──────────────────────\n' +
    '📌 *Menu Utama*\n\n' +
    '• ⚙️  *Status Server*\n' +
    '  └ Periksa koneksi dan status SMTP.\n\n' +
    '• 📲  *Mode banding (Fix Merah 🔴)*\n' +
    '  └ Cek nomor WhatsApp secara cepat dan efisien.\n\n' +
    '• ✉️  *Test Kirim Email*\n' +
    '  └ Uji kirim email melalui server SMTP.\n\n' +
    '• 🧩  *Pairing & CekBio*\n' +
    '  └ Pair akun WhatsApp atau lihat bio nomor.\n\n' +
    '──────────────────────\n' +
    '👨‍💻 *Developed by:* _RizkyMaxz × Jojork_\n' +
    '🔖 *Bot Version:* v4.09.6 Premium Edition\n'
  );
}

function dashboardMenu() {
  return {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '⚡ Status Server', callback_data: 'status' }],
        [
          { text: '📲 Mode banding', callback_data: 'banding' },
          { text: '✉️ Test Email', callback_data: 'testsend' }
        ],
        [{ text: '🧩 Pairing & CekBio', callback_data: 'pairmenu' }],
        [{ text: '🛠️ Refresh Dashboard', callback_data: 'menu' }]
      ]
    }
  };
}

// 🎯 Command /start → kirim dashboard utama
bot.start((ctx) => {
  ctx.replyWithMarkdown(dashboardText(), dashboardMenu());
});

// Handler tombol utama dashboard
bot.on('callback_query', async (ctx) => {
  const action = ctx.callbackQuery.data;
  const msgId = ctx.callbackQuery.message.message_id;
  const chatId = ctx.callbackQuery.message.chat.id; // ✅ perbaikan di sini

  try {
    // 🏠 DASHBOARD UTAMA
    if (action === 'menu') {
      await ctx.telegram.editMessageText(
        chatId,
        msgId,
        undefined,
        dashboardText(),
        dashboardMenu()
      );
      return;
    }

    // ⚡ STATUS SERVER
    if (action === 'status') {
      const data = await callApi('/status?apikey=admin');

      const statusText = `
📊 *STATUS SERVER - ${data.owner || 'Unknown'}*
━━━━━━━━━━━━━━━
📦 *Total Email:* ${data.total_email}
✅ *Connect:* ${data.connect}
❌ *Disconnect:* ${data.disconnect}
🚀 *${data.message || 'Service aktif'}*

🔙 Kembali ke Dashboard
`.trim();

      await ctx.telegram.editMessageText(
        chatId,
        msgId,
        undefined,
        statusText,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🏠 Dashboard', callback_data: 'menu' }],
              [{ text: '🔄 Refresh', callback_data: 'status' }]
            ]
          }
        }
      );
      return;
    }

    // 📲 MODE banding
    if (action === 'banding') {
      await ctx.telegram.editMessageText(
        chatId,
        msgId,
        undefined,
        '📲 *Mode banding*\n' +
          '────────────────────\n' +
          'Gunakan perintah berikut untuk mengecek nomor WhatsApp:\n\n' +
          '`/banding <nomor>`\n' +
          '_Contoh:_ `/banding 628123456789`\n\n' +
          '🔹 Mode ini digunakan untuk pengecekan cepat (Fix Merah 🔴)\n\n' +
          '────────────────────\n' +
          '🏠 *Kembali ke Dashboard*',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '🏠 Dashboard', callback_data: 'menu' }]]
          }
        }
      );
      return;
    }

    // ✉️ TEST EMAIL
    if (action === 'testsend') {
      await ctx.telegram.editMessageText(
        chatId,
        msgId,
        undefined,
        '✉️ *Test Kirim Email*\n' +
          '────────────────────\n' +
          'Gunakan format perintah berikut:\n\n' +
          '`/testsend <email> <nomor>`\n\n' +
          '_Contoh:_\n' +
          '`/testsend user@mail.com 628123456789`\n\n' +
          '🔹 Fitur ini berfungsi untuk menguji koneksi dan pengiriman email SMTP.\n\n' +
          '────────────────────\n' +
          '🏠 *Kembali ke Dashboard*',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '🏠 Dashboard', callback_data: 'menu' }]]
          }
        }
      );
      return;
    }

    // 🧩 PAIRING & CEKBIO
    if (action === 'pairmenu') {
      await ctx.telegram.editMessageText(
        chatId,
        msgId,
        undefined,
        '🧩 *Pairing & CekBio*\n' +
          '────────────────────\n' +
          'Perintah yang tersedia:\n\n' +
          '`/pairing 628xxxxxxx`\n' +
          '`/cek 628xxxxxxx`\n\n' +
          '📄 Kirim *file .txt* atau *.csv* untuk melakukan pengecekan massal.\n\n' +
          '🔹 Gunakan fitur ini untuk pairing WhatsApp dan membaca bio secara otomatis.\n\n' +
          '────────────────────\n' +
          '🏠 *Kembali ke Dashboard*',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '🏠 Dashboard', callback_data: 'menu' }]]
          }
        }
      );
      return;
    }

  } catch (err) {
    console.error('Callback Error:', err);

    // ✅ perbaikan: tambahkan backtick agar template string valid
    await ctx.answerCbQuery(`❌ Error: ${err.message}`, { show_alert: true });
  }

  await ctx.answerCbQuery();
});

bot.command('status', async (ctx) => {
  try {
    const data = await callApi('/status');

    const text = `
📊 *STATUS SERVER - ${data.owner || 'Unknown'}*
━━━━━━━━━━━━━━━
📦 *Total Email:* ${data.total_email}
✅ *Connect:* ${data.connect}
❌ *Disconnect:* ${data.disconnect}
🚀 *${data.message || 'Service aktif'}*
`;

    await ctx.replyWithMarkdown(text, { disable_web_page_preview: true });
  } catch (err) {
    console.error(err);
    await ctx.reply(`❌ *Error:* ${err.message}`, { parse_mode: 'Markdown' });
  }
});

// /testsend <email> <nomor>
bot.command('testsend', async (ctx) => {
  const parts = ctx.message.text.split(' ');

  // Format minimal: /testsend <email> <pesan...>
  if (!parts[1]) {
    return ctx.reply('❌ Format: /testsend <email> <pesan>');
  }

  const email = parts[1];
  const pesan = parts.slice(2).join(' '); // biar pesan bisa panjang (bisa spasi)

  if (!pesan) {
    return ctx.reply('❌ Masukkan pesan yang ingin dikirim.\nContoh:\n/testsend email@gmail.com Halo tim WhatsApp, saya ingin banding akun saya.');
  }

  try {
    const data = await callApi('/testsend', { email, pesan });
    ctx.replyWithMarkdown(formatResult(data));
  } catch (err) {
    ctx.reply(`❌ Error: ${err.message}`);
  }
});

// Normal mode -> tangkap nomor WA
// ==========================
// MODE banding (ANTI-SPAM 1 NOMOR / 120s)
// ==========================
bot.command('banding', async (ctx) => {
  const userId = ctx.from.id;
  const now = Date.now();

  const args = ctx.message.text.split(' ').slice(1);
  const nomor = args[0]?.trim();

  // Validasi input
  if (!nomor) {
    return ctx.reply('⚠️ Kirim nomor setelah command.\nContoh:\n/banding 6281234567890');
  }

  if (!/^\d{8,15}$/.test(nomor)) {
    return ctx.reply('❌ Nomor tidak valid. Gunakan hanya angka tanpa spasi atau simbol.');
  }

  // Cek cooldown user
  const cooldownEnd = userCooldowns[userId] || 0;
  if (now < cooldownEnd) {
    const wait = Math.ceil((cooldownEnd - now) / 1000);
    return ctx.reply(`🕓 Tunggu ${wait}s sebelum bisa cek nomor lagi.`);
  }

  // Aktifkan cooldown 120 detik
  startCooldown(ctx, userId, 120);

  try {
    await ctx.reply(`🔍 Memeriksa nomor *${nomor}*...`, { parse_mode: 'Markdown' });
    const data = await callApi('/banding', { nomor });
    await ctx.replyWithMarkdown(`✅ *Hasil nomor ${nomor}:*\n${formatResult(data)}`);
  } catch (err) {
    await ctx.reply(`❌ Terjadi kesalahan: ${err.message}`);
  }
});

bot.launch().then(() => console.log('🤖 BOT TELE AKTIF | WA CLIENT JALAN ✅'));