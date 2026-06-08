// api/events.js
// ─────────────────────────────────────────────────────────────────────────────
// Endpoint: GET /api/events
// Dibaca oleh SunakTV Android untuk menampilkan daftar live event.
//
// Query params (opsional):
//   ?status=live        → filter hanya yang sedang live
//   ?status=upcoming    → filter yang akan datang
//   ?platform=vidio     → filter per platform
//
// Response: JSON array of event objects
// ─────────────────────────────────────────────────────────────────────────────

const admin = require("firebase-admin");

// Inisialisasi Firebase Admin (hanya sekali)
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

module.exports = async (req, res) => {
  // Izinkan akses dari Android (CORS)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { status, platform } = req.query;

    // Ambil semua event dari Firestore
    let query = db.collection("live_events");

    // Filter status jika ada
    if (status) {
      query = query.where("status", "==", status.toLowerCase());
    }

    // Filter platform jika ada
    if (platform) {
      query = query.where("platform_id", "==", platform.toLowerCase());
    }

    // Urutkan: live dulu, lalu upcoming, lalu ended
    // (Firestore tidak bisa orderBy string custom, jadi kita sort di JS)
    const snapshot = await query.get();

    let events = [];
    snapshot.forEach((doc) => {
      events.push({ id: doc.id, ...doc.data() });
    });

    // Sort: live → upcoming → ended
    const order = { live: 0, upcoming: 1, ended: 2 };
    events.sort((a, b) => {
      const oa = order[a.status] ?? 9;
      const ob = order[b.status] ?? 9;
      return oa - ob;
    });

    return res.status(200).json(events);

  } catch (err) {
    console.error("events.js error:", err);
    return res.status(500).json({ error: "Gagal mengambil data event" });
  }
};
