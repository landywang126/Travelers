const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// 託管 public 資料夾內的靜態網頁
app.use(express.static(path.join(__dirname, 'public')));

// 存放打卡資料（預設 2 個示範座標）
let checkins = [
  {
    id: 1,
    userId: "system",
    lat: 25.0330,
    lng: 121.5654,
    country: "台灣",
    city: "台北市",
    user: "Alex",
    message: "台北 101 打卡！",
    color: "#2563eb",
    createdAt: new Date().toISOString()
  },
  {
    id: 2,
    userId: "system",
    lat: 35.6586,
    lng: 139.7454,
    country: "日本",
    city: "東京都",
    user: "Emma",
    message: "東京鐵塔好美！",
    color: "#ef4444",
    createdAt: new Date().toISOString()
  }
];

// GET: 取得所有打卡點
app.get('/api/checkins', (req, res) => {
  const { userId } = req.query;
  if (userId) {
    return res.json(checkins.filter(item => item.userId === userId));
  }
  res.json(checkins);
});

// POST: 新增打卡點
app.post('/api/checkins', (req, res) => {
  const { userId, lat, lng, country, city, user, message, color } = req.body;

  if (lat === undefined || lng === undefined || !userId) {
    return res.status(400).json({ error: "經緯度與 userId 為必填項目" });
  }

  const newCheckin = {
    id: Date.now(),
    userId,
    lat: Number(lat),
    lng: Number(lng),
    country: country || "未知國家",
    city: city || "未知城市",
    user: user?.trim() || "匿名旅人",
    message: message?.trim() || "",
    color: color || "#2563eb",
    createdAt: new Date().toISOString()
  };

  checkins.push(newCheckin);
  res.status(201).json(newCheckin);
});

app.patch('/api/checkins/user/:userId', (req, res) => {
    const { userId } = req.params;
    const { user } = req.body;

    if (!user || !user.trim()) {
      return res.status(400).json({ error: "暱稱不能為空" });
    }

    const newName = user.trim();
    let updatedCount = 0;

    // 遍歷所有打卡，符合 userId 的項目一律更換暱稱
    checkins.forEach(item => {
      if (item.userId === userId) {
        item.user = newName;
        updatedCount++;
      }
    });

    res.json({ message: "暱稱同步成功", updatedCount, newName });
  });
  // 簡易反查快取
const geoCache = new Map();

// GET /api/geocode/reverse
app.get('/api/geocode/reverse', async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) {
    return res.status(400).json({ error: '缺少經緯度' });
  }

  const cacheKey = `${parseFloat(lat).toFixed(2)},${parseFloat(lng).toFixed(2)}`;
  if (geoCache.has(cacheKey)) {
    return res.json(geoCache.get(cacheKey));
  }

  const targetUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=zh-TW,zh-Hant,zh,en`;

  try {
    console.log(`[Geocode 請求] 正在反查座標: lat=${lat}, lng=${lng}`);

    const fetchRes = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        // 🔥 必須提供真實可識別的 User-Agent 與 Referer，否則 OSM 會直接回傳 403 阻擋
        'User-Agent': 'TravelerCheckinMapDemo/1.0 (contact: demo_student@gmail.com)',
        'Referer': 'http://localhost:3000'
      }
    });

    console.log(`[Geocode 回應狀態碼]: ${fetchRes.status}`);

    if (!fetchRes.ok) {
      const errorText = await fetchRes.text();
      console.error(`[Nominatim 拒絕回應]:`, errorText);
      return res.json({ country: "未知國家", city: "未知地點" });
    }

    const data = await fetchRes.json();
    console.log('[Nominatim 原始回傳資料]:', JSON.stringify(data.address || data.name || data.display_name));

    const addr = data.address || {};

    let rawCountry = addr.country;
    let rawCity = 
      addr.city || 
      addr.town || 
      addr.county ||
      addr.borough || 
      addr.suburb || 
      addr.municipality || 
      addr.city_district || 
      addr.state || 
      addr.province || 
      addr.village ||
      data.name;

    // 保底：若抓不到 city，從 display_name 切割
    if (!rawCity && data.display_name) {
      const parts = data.display_name.split(',').map(s => s.trim());
      if (parts.length >= 2) {
        rawCity = parts[0];
        rawCountry = rawCountry || parts[parts.length - 1];
      }
    }

    const result = {
      country: rawCountry || "未知國家",
      city: rawCity || "未知地點"
    };

    if (geoCache.size > 500) geoCache.clear();
    geoCache.set(cacheKey, result);

    console.log('[最終回傳前端結果]:', result);
    res.json(result);
  } catch (err) {
    console.error('[後端反查發生 Exception 錯誤]:', err);
    res.json({ country: "未知國家", city: "未知地點" });
  }
});

app.listen(PORT, () => {
  console.log(`伺服器運行中：http://localhost:${PORT}`);
});