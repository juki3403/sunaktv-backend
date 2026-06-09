const admin = require("firebase-admin");
const fetch = require("node-fetch");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   String(process.env.FIREBASE_PROJECT_ID || "").trim(),
      clientEmail: String(process.env.FIREBASE_CLIENT_EMAIL || "").trim(),
      privateKey:  String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

// Header meniru browser Android supaya tidak diblokir
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8",
  "Referer": "https://m.vidio.com/",
  "Origin": "https://m.vidio.com",
};

// ─────────────────────────────────────────────────────────────────────────────
// SCRAPER VIDIO — plenty.vidio.com/events
// ─────────────────────────────────────────────────────────────────────────────
async function scrapeVidio() {
  const events = [];
  try {
    // Endpoint utama
    const urls = [
      "https://plenty.vidio.com/events?page=1&per_page=20",
      "https://plenty.vidio.com/events?status=live&page=1&per_page=20",
      "https://plenty.vidio.com/events?status=upcoming&page=1&per_page=20",
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: BROWSER_HEADERS,
          timeout: 8000,
        });
        if (!res.ok) {
          console.warn("Vidio fetch gagal:", url, res.status);
          continue;
        }
        const json = await res.json();

        // Data bisa di berbagai key
        const items = json.data || json.events || json.lives || json || [];
        if (!Array.isArray(items)) continue;

        for (const item of items) {
          // Hindari duplikat
          if (events.find(e => e.id === `vidio_${item.id}`)) continue;

          let status = "upcoming";
          if (item.is_live || item.status === "live" || item.streaming_status === "live") {
            status = "live";
          } else if (item.status === "ended" || item.streaming_status === "ended") {
            status = "ended";
          }

          let startTime = "";
          const rawTime = item.start_time || item.started_at || item.scheduled_start || item.match_date || "";
          if (rawTime) {
            try {
              const d = new Date(rawTime);
              const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
              const h = String(wib.getUTCHours()).padStart(2, "0");
              const m = String(wib.getUTCMinutes()).padStart(2, "0");
              startTime = `${h}:${m} WIB`;
            } catch (_) {}
          }

          const thumbnail =
            item.image_url || item.thumbnail || item.image ||
            item.backdrop_url || item.cover_image ||
            item.snapshot_url || "";

          events.push({
            id:          `vidio_${item.id}`,
            platform:    "Vidio",
            platform_id: "vidio",
            title:       item.title || item.name || item.match_title || "Live Event",
            thumbnail:   thumbnail,
            status:      status,
            start_time:  startTime,
            category:    item.category_name || item.sport || item.label || "Live",
            embed_url:   `https://www.vidio.com/live/${item.id}`,
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
// SCRAPER MOLA
// ─────────────────────────────────────────────────────────────────────────────
async function scrapeMola() {
  const events = [];
  try {
    const urls = [
      "https://api.mola.tv/v2/contents?content_type=live&page=1&page_size=20",
      "https://api.mola.tv/v1/events?status=live&page=1",
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: { ...BROWSER_HEADERS, "Referer": "https://mola.tv/" },
          timeout: 8000,
        });
        if (!res.ok) continue;
        const json = await res.json();
        const items = json.data || json.contents || json.events || json || [];
        if (!Array.isArray(items)) continue;

        for (const item of items) {
          if (events.find(e => e.id === `mola_${item.id}`)) continue;

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
            id:          `mola_${item.id}`,
            platform:    "Mola TV",
            platform_id: "mola",
            title:       item.title || item.name || "Live Event",
            thumbnail:   item.thumbnail || item.poster || item.image || "",
            status:      status,
            start_time:  startTime,
            category:    item.category || item.sport || "Live",
            embed_url:   `https://mola.tv/watch/${item.id}`,
            updated_at:  Date.now(),
          });
        }
      } catch (innerErr) {
        console.warn("Mola sub-fetch error:", innerErr.message);
      }
    }
  } catch (err) {
    console.error("scrapeMola error:", err.message);
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// DUMMY — fallback kalau semua scraper gagal
// ─────────────────────────────────────────────────────────────────────────────
function getDummyEvents() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mm = String(wib.getUTCMinutes()).padStart(2, "0");
  const timeNow = `${hh}:${mm} WIB`;
  return [
    { id:"dummy_001", platform:"Vidio", platform_id:"vidio", title:"BRI Liga 1: Persija vs Persib", thumbnail:"https://placehold.co/320x180/E53935/FFFFFF?text=LIVE", status:"live", start_time:timeNow, category:"Sports", embed_url:"https://www.vidio.com/live/5", updated_at:Date.now() },
    { id:"dummy_002", platform:"Vidio", platform_id:"vidio", title:"Serie A: AC Milan vs Inter Milan", thumbnail:"https://placehold.co/320x180/1565C0/FFFFFF?text=SOON", status:"upcoming", start_time:"21:00 WIB", category:"Sports", embed_url:"https://www.vidio.com/live/10", updated_at:Date.now() },
    { id:"dummy_003", platform:"Mola TV", platform_id:"mola", title:"NBA: LA Lakers vs Golden State Warriors", thumbnail:"https://placehold.co/320x180/6A1B9A/FFFFFF?text=LIVE", status:"live", start_time:timeNow, category:"Basketball", embed_url:"https://mola.tv/watch/nba-live", updated_at:Date.now() },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER UTAMA
// ─────────────────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  try {
    console.log("Scrape dimulai...");

    const [vidioEvents, molaEvents] = await Promise.all([
      scrapeVidio(),
      scrapeMola(),
    ]);

    let allEvents = [...vidioEvents, ...molaEvents];
    const useDummy = allEvents.length === 0;

    if (useDummy) {
      console.log("Scraper kosong, pakai data dummy.");
      allEvents = getDummyEvents();
    }

    // Upsert ke Firestore
    const batch = db.batch();
    for (const ev of allEvents) {
      const ref = db.collection("live_events").doc(ev.id);
      batch.set(ref, ev, { merge: true });
    }
    await batch.commit();

    // Hapus event ended yang lebih dari 2 jam
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const oldSnap = await db.collection("live_events")
      .where("status", "==", "ended")
      .where("updated_at", "<", twoHoursAgo)
      .get();
    if (!oldSnap.empty) {
      const delBatch = db.batch();
      oldSnap.forEach(doc => delBatch.delete(doc.ref));
      await delBatch.commit();
      console.log(`Hapus ${oldSnap.size} event lama.`);
    }

    console.log(`Scrape selesai: ${allEvents.length} events.`);
    return res.status(200).json({
      success: true,
      count: allEvents.length,
      sources: {
        vidio: vidioEvents.length,
        mola:  molaEvents.length,
        dummy: useDummy ? allEvents.length : 0,
      },
    });

  } catch (err) {
    console.error("scrape.js error:", err);
    return res.status(500).json({ error: err.message });
  }
};
  
