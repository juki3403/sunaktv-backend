// api/scrape.js
// ─────────────────────────────────────────────────────────────────────────────
// Endpoint: GET /api/scrape
// Dipanggil otomatis oleh Vercel Cron (sekali sehari di free tier),
// atau bisa dipanggil manual / oleh GitHub Actions tiap 15 menit.
//
// Cara kerja:
//   1. Fetch data live event dari Vidio dan Mola
//   2. Normalisasi data ke format standar
//   3. Simpan/update ke Firestore collection "live_events"
//   4. Hapus event yang sudah "ended" lebih dari 2 jam
//
// Format event yang disimpan ke Firestore:
// {
//   id:          "vidio_12345"        ← unik per event
//   platform:    "Vidio"              ← nama tampilan
//   platform_id: "vidio"              ← untuk filter query
//   title:       "BRI Liga 1: ..."
//   thumbnail:   "https://..."
//   status:      "live" | "upcoming" | "ended"
//   start_time:  "19:00"             ← jam lokal WIB
//   category:    "Sports"
//   embed_url:   "https://..."       ← untuk PlayerEngine nanti
//   updated_at:  1234567890          ← Unix timestamp
// }
// ─────────────────────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
const fetch = require("node-fetch");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:    process.env.FIREBASE_PROJECT_ID,
      clientEmail:  process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:   process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
    databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`,
  });
}

const db = admin.firestore();

// ─────────────────────────────────────────────────────────────────────────────
// SCRAPER VIDIO
// Menggunakan endpoint tidak resmi Vidio yang mengembalikan JSON publik.
// Tidak butuh login untuk melihat daftar live event.
// ─────────────────────────────────────────────────────────────────────────────
async function scrapeVidio() {
  const events = [];
  try {
    // Endpoint publik Vidio untuk live channels/events
    const urls = [
      // Live channels (TV & sports)
      "https://api.vidio.com/lives?order=start_time&page=1&per_page=20",
      // Live events / pertandingan
      "https://api.vidio.com/live_events?page=1&per_page=20",
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36",
            "Accept": "application/json",
            "Referer": "https://www.vidio.com",
          },
          timeout: 8000,
        });

        if (!res.ok) continue;
        const json = await res.json();

        // Data bisa di root array atau dalam key "lives" / "live_events" / "data"
        const items = json.lives || json.live_events || json.data || json || [];
        if (!Array.isArray(items)) continue;

        for (const item of items) {
          // Tentukan status
          let status = "upcoming";
          if (item.is_live || item.status === "live" || item.streaming_status === "live") {
            status = "live";
          } else if (item.status === "ended" || item.streaming_status === "ended") {
            status = "ended";
          }

          // Format jam WIB dari ISO string
          let startTime = "";
          const rawTime = item.start_time || item.started_at || item.scheduled_start || "";
          if (rawTime) {
            try {
              const d = new Date(rawTime);
              // Konversi ke WIB (UTC+7)
              const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
              const h = String(wib.getUTCHours()).padStart(2, "0");
              const m = String(wib.getUTCMinutes()).padStart(2, "0");
              startTime = `${h}:${m} WIB`;
            } catch (_) {}
          }

          // Ambil thumbnail terbaik yang tersedia
          const thumbnail =
            item.image ||
            item.thumbnail ||
            item.image_url ||
            item.backdrop_url ||
            item.cover_image ||
            "";

          // Embed URL untuk PlayerEngine nanti
          const embedUrl = item.embed_url ||
            (item.id ? `https://www.vidio.com/live/${item.id}/videos` : "");

          events.push({
            id:          `vidio_${item.id || Math.random().toString(36).slice(2)}`,
            platform:    "Vidio",
            platform_id: "vidio",
            title:       item.title || item.name || item.channel_name || "Live Event",
            thumbnail:   thumbnail,
            status:      status,
            start_time:  startTime,
            category:    item.category_name || item.sport || item.genre || "Live",
            embed_url:   embedUrl,
            updated_at:  Date.now(),
          });
        }
      } catch (innerErr) {
        console.warn("Vidio sub-fetch error:", innerErr.message);
      }
    }
  } catch (err) {
    console.error("scrapeVidio error:", err.message);
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCRAPER MOLA TV
// ─────────────────────────────────────────────────────────────────────────────
async function scrapeMola() {
  const events = [];
  try {
    const res = await fetch(
      "https://api.mola.tv/v2/contents?content_type=live&page=1&page_size=20",
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36",
          "Accept": "application/json",
          "Referer": "https://mola.tv",
        },
        timeout: 8000,
      }
    );

    if (!res.ok) return events;
    const json = await res.json();
    const items = json.data || json.contents || json || [];
    if (!Array.isArray(items)) return events;

    for (const item of items) {
      let status = "upcoming";
      if (item.is_live || item.status === "live") status = "live";
      else if (item.status === "ended")           status = "ended";

      let startTime = "";
      const rawTime = item.start_time || item.scheduled_at || "";
      if (rawTime) {
        try {
          const d = new Date(rawTime);
          const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
          const h = String(wib.getUTCHours()).padStart(2, "0");
          const m = String(wib.getUTCMinutes()).padStart(2, "0");
          startTime = `${h}:${m} WIB`;
        } catch (_) {}
      }

      events.push({
        id:          `mola_${item.id || Math.random().toString(36).slice(2)}`,
        platform:    "Mola TV",
        platform_id: "mola",
        title:       item.title || item.name || "Live Event",
        thumbnail:   item.thumbnail || item.poster || item.image || "",
        status:      status,
        start_time:  startTime,
        category:    item.category || item.sport || "Live",
        embed_url:   item.embed_url || `https://mola.tv/watch/${item.id || ""}`,
        updated_at:  Date.now(),
      });
    }
  } catch (err) {
    console.error("scrapeMola error:", err.message);
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA DUMMY — dipakai kalau kedua scraper gagal / API berubah
// Hapus fungsi ini setelah scraper sungguhan sudah jalan
// ─────────────────────────────────────────────────────────────────────────────
function getDummyEvents() {
  const now = new Date();
  const wibNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const hh = String(wibNow.getUTCHours()).padStart(2, "0");
  const mm = String(wibNow.getUTCMinutes()).padStart(2, "0");
  const timeNow = `${hh}:${mm} WIB`;

  return [
    {
      id: "dummy_001",
      platform: "Vidio",
      platform_id: "vidio",
      title: "BRI Liga 1: Persija Jakarta vs Persib Bandung",
      thumbnail: "https://via.placeholder.com/320x180/E53935/FFFFFF?text=LIVE",
      status: "live",
      start_time: timeNow,
      category: "Sports",
      embed_url: "https://www.vidio.com/live/5",
      updated_at: Date.now(),
    },
    {
      id: "dummy_002",
      platform: "Vidio",
      platform_id: "vidio",
      title: "Serie A: AC Milan vs Inter Milan",
      thumbnail: "https://via.placeholder.com/320x180/1565C0/FFFFFF?text=SOON",
      status: "upcoming",
      start_time: "21:00 WIB",
      category: "Sports",
      embed_url: "https://www.vidio.com/live/10",
      updated_at: Date.now(),
    },
    {
      id: "dummy_003",
      platform: "Mola TV",
      platform_id: "mola",
      title: "NBA: LA Lakers vs Golden State Warriors",
      thumbnail: "https://via.placeholder.com/320x180/6A1B9A/FFFFFF?text=LIVE",
      status: "live",
      start_time: timeNow,
      category: "Basketball",
      embed_url: "https://mola.tv/watch/nba-live",
      updated_at: Date.now(),
    },
    {
      id: "dummy_004",
      platform: "Vidio",
      platform_id: "vidio",
      title: "Konser Musik: Java Jazz Festival 2026",
      thumbnail: "https://via.placeholder.com/320x180/F57C00/FFFFFF?text=SOON",
      status: "upcoming",
      start_time: "20:00 WIB",
      category: "Entertainment",
      embed_url: "https://www.vidio.com/live/20",
      updated_at: Date.now(),
    },
    {
      id: "dummy_005",
      platform: "Mola TV",
      platform_id: "mola",
      title: "Premier League: Manchester City vs Arsenal",
      thumbnail: "https://via.placeholder.com/320x180/2E7D32/FFFFFF?text=SELESAI",
      status: "ended",
      start_time: "02:30 WIB",
      category: "Sports",
      embed_url: "https://mola.tv/watch/epl-live",
      updated_at: Date.now(),
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER UTAMA
// ─────────────────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  // Proteksi: hanya bisa dipanggil oleh Vercel Cron atau dengan secret key
  // Uncomment setelah deploy:
  // const secret = req.headers["x-scrape-secret"] || req.query.secret;
  // if (secret !== process.env.SCRAPE_SECRET) {
  //   return res.status(401).json({ error: "Unauthorized" });
  // }

  try {
    console.log("Scrape dimulai...");

    // Jalankan scraper Vidio dan Mola secara paralel
    const [vidioEvents, molaEvents] = await Promise.all([
      scrapeVidio(),
      scrapeMola(),
    ]);

    let allEvents = [...vidioEvents, ...molaEvents];

    // Kalau kedua scraper tidak menghasilkan data, pakai dummy
    if (allEvents.length === 0) {
      console.log("Scraper kosong, pakai data dummy.");
      allEvents = getDummyEvents();
    }

    // Simpan ke Firestore (upsert — update kalau sudah ada, insert kalau baru)
    const batch = db.batch();
    for (const ev of allEvents) {
      const ref = db.collection("live_events").doc(ev.id);
      batch.set(ref, ev, { merge: true });
    }
    await batch.commit();

    // Hapus event "ended" yang lebih dari 2 jam (bersih-bersih)
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const oldSnap = await db.collection("live_events")
      .where("status", "==", "ended")
      .where("updated_at", "<", twoHoursAgo)
      .get();

    if (!oldSnap.empty) {
      const delBatch = db.batch();
      oldSnap.forEach((doc) => delBatch.delete(doc.ref));
      await delBatch.commit();
      console.log(`Hapus ${oldSnap.size} event lama.`);
    }

    console.log(`Scrape selesai: ${allEvents.length} events disimpan.`);
    return res.status(200).json({
      success: true,
      count: allEvents.length,
      sources: {
        vidio: vidioEvents.length,
        mola:  molaEvents.length,
        dummy: allEvents.length === getDummyEvents().length ? getDummyEvents().length : 0,
      },
    });

  } catch (err) {
    console.error("scrape.js error:", err);
    return res.status(500).json({ error: err.message });
  }
};
