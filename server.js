import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

//.env 
dotenv.config();
const { Pool } = pg;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

//public files
app.use(express.static(path.join(__dirname, 'public')));

//database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } 
});

//connection test
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Supabase 連線失敗:', err.message);
  } else {
    console.log('✅ 成功連線至 Supabase PostgreSQL 資料庫！');
    release();
  }
});

//GET all the checkins（SQL SELECT）
app.get('/api/checkins', async (req, res) => {
  try {
    const queryText = `
      SELECT 
        id, 
        user_id AS "userId", 
        lat, 
        lng, 
        country, 
        city, 
        user_name AS "user", 
        message, 
        color, 
        created_at AS "createdAt"
      FROM checkins 
      ORDER BY created_at ASC
    `;
    const result = await pool.query(queryText);
    res.json(result.rows);
  } catch (err) {
    console.error('SQL 讀取失敗:', err);
    res.status(500).json({ error: '資料庫讀取失敗' });
  }
});

// POST（SQL INSERT）
app.post('/api/checkins', async (req, res) => {
  const { userId, lat, lng, country, city, user, message, color } = req.body;

  if (lat === undefined || lng === undefined || !userId) {
    return res.status(400).json({ error: '經緯度與 userId 為必填項目' });
  }

  try {
    const insertText = `
      INSERT INTO checkins (user_id, lat, lng, country, city, user_name, message, color)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING 
        id, 
        user_id AS "userId", 
        lat, 
        lng, 
        country, 
        city, 
        user_name AS "user", 
        message, 
        color, 
        created_at AS "createdAt"
    `;

    const values = [
      userId,
      Number(lat),
      Number(lng),
      country || '未知國家',
      city || '未知地點',
      user?.trim() || '匿名旅人',
      message?.trim() || '',
      color || '#2563eb'
    ];

    const result = await pool.query(insertText, values);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('SQL 寫入失敗:', err);
    res.status(500).json({ error: '資料庫寫入失敗' });
  }
});

app.patch('/api/checkins/user/:userId', async (req, res) => {
  const { userId } = req.params;
  const { user } = req.body;

  if (!user || !user.trim()) {
    return res.status(400).json({ error: "暱稱不能為空" });
  }

  const newName = user.trim();

  try {
    // nickname updating
    const updateSql = `
      UPDATE checkins
      SET user_name = $1
      WHERE user_id = $2
    `;

    const result = await pool.query(updateSql, [newName, userId]);

    // result.rowCount 
    res.json({
      message: "暱稱同步成功",
      updatedCount: result.rowCount,
      newName: newName
    });
  } catch (err) {
    console.error('SQL 更新暱稱失敗:', err);
    res.status(500).json({ error: "資料庫更新失敗" });
  }
});

app.delete('/api/checkins/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.body?.userId; 

  try {
    let deleteSql = `DELETE FROM checkins WHERE id = $1`;
    let values = [id];

    if (userId) {
      deleteSql += ` AND user_id = $2`;
      values.push(userId);
    }

    deleteSql += ` RETURNING id`;
    const result = await pool.query(deleteSql, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: '找不到該筆打卡紀錄或無權限刪除' });
    }

    res.json({ message: '打卡紀錄已刪除', id: result.rows[0].id });
  } catch (err) {
    console.error('SQL 刪除失敗:', err);
    res.status(500).json({ error: '資料庫刪除失敗' });
  }
});



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

// GET: statistics (SQL SELECT)
app.get('/api/stats', async (req, res) => {
  const { userId } = req.query;

  try {
    const whereClause = userId ? 'WHERE user_id = $1' : '';
    const topWhereClause = userId 
      ? "WHERE user_id = $1 AND country IS NOT NULL AND country <> '未知國家'"
      : "WHERE country IS NOT NULL AND country <> '未知國家'";
    const queryParams = userId ? [userId] : [];

    const overviewSql = `
      SELECT 
        COUNT(*)::int AS "totalCheckins",
        COUNT(DISTINCT country)::int AS "totalCountries"
      FROM checkins
      ${whereClause};
    `;

    const topCountriesSql = `
      SELECT 
        country, 
        COUNT(*)::int AS count
      FROM checkins
      ${topWhereClause}
      GROUP BY country
      ORDER BY count DESC
      LIMIT 5;
    `;

    const [overviewResult, topCountriesResult] = await Promise.all([
      pool.query(overviewSql, queryParams),
      pool.query(topCountriesSql, queryParams)
    ]);

    res.json({
      isPersonal: Boolean(userId),
      totalCheckins: overviewResult.rows[0].totalCheckins,
      totalCountries: overviewResult.rows[0].totalCountries,
      topCountries: topCountriesResult.rows
    });
  } catch (err) {
    console.error('統計查詢失敗:', err);
    res.status(500).json({ error: '無法讀取統計數據' });
  }
});

app.listen(PORT, () => {
  console.log(`伺服器運行中：http://localhost:${PORT}`);
});