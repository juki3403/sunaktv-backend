const admin = require("firebase-admin");

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

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { status, platform } = req.query || {};

    const snapshot = await db.collection("live_events").get();

    let events = [];
    snapshot.forEach((doc) => {
      events.push({ id: doc.id, ...doc.data() });
    });

    if (status)   events = events.filter(e => e.status === status);
    if (platform) events = events.filter(e => e.platform_id === platform);

    // Sort: live → upcoming → ended
    const order = { live: 0, upcoming: 1, ended: 2 };
    events.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

    return res.status(200).json(events);

  } catch (err) {
    console.error("events.js error:", err.message);
    return res.status(500).json({ error: "Gagal mengambil data event" });
  }
};
    
