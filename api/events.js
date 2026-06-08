module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mm = String(wib.getUTCMinutes()).padStart(2, "0");
  const timeNow = hh + ":" + mm + " WIB";
  const events = [
    { id:"dummy_001", platform:"Vidio", platform_id:"vidio", title:"BRI Liga 1: Persija vs Persib", thumbnail:"https://placehold.co/320x180/E53935/FFFFFF?text=LIVE", status:"live", start_time:timeNow, category:"Sports", embed_url:"https://www.vidio.com/live/5" },
    { id:"dummy_002", platform:"Vidio", platform_id:"vidio", title:"Serie A: AC Milan vs Inter Milan", thumbnail:"https://placehold.co/320x180/1565C0/FFFFFF?text=SOON", status:"upcoming", start_time:"21:00 WIB", category:"Sports", embed_url:"https://www.vidio.com/live/10" },
    { id:"dummy_003", platform:"Mola TV", platform_id:"mola", title:"NBA: LA Lakers vs Golden State Warriors", thumbnail:"https://placehold.co/320x180/6A1B9A/FFFFFF?text=LIVE", status:"live", start_time:timeNow, category:"Basketball", embed_url:"https://mola.tv/watch/nba-live" },
    { id:"dummy_004", platform:"Vidio", platform_id:"vidio", title:"Konser Musik: Java Jazz Festival 2026", thumbnail:"https://placehold.co/320x180/F57C00/FFFFFF?text=SOON", status:"upcoming", start_time:"20:00 WIB", category:"Entertainment", embed_url:"https://www.vidio.com/live/20" },
    { id:"dummy_005", platform:"Mola TV", platform_id:"mola", title:"Premier League: Man City vs Arsenal", thumbnail:"https://placehold.co/320x180/2E7D32/FFFFFF?text=SELESAI", status:"ended", start_time:"02:30 WIB", category:"Sports", embed_url:"https://mola.tv/watch/epl-live" }
  ];
  const { status, platform } = req.query || {};
  let result = events;
  if (status) result = result.filter(e => e.status === status);
  if (platform) result = result.filter(e => e.platform_id === platform);
  return res.status(200).json(result);
};
