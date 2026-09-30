const express = require("express");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");
const DATABASE_URL = process.env.DATABASE_URL;

let pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) : null;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use("/api", (req, res, next) => {
  const host = req.hostname;
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1";

  if (!isLocal) {
    return res.status(404).json({ error: "Not found" });
  }

  next();
});

async function initDatabase() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_data (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL
    )
  `);

  await pool.query(`
    INSERT INTO app_data (id, data)
    VALUES (1, '{"folders":[],"tasks":[],"inbox":[]}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `);
}

app.get("/api/data", async (req, res) => {
  try {
    if (pool) {
      const result = await pool.query("SELECT data FROM app_data WHERE id = 1");
      return res.json(result.rows[0].data);
    }

    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify({ folders: [], tasks: [], inbox: [] }, null, 2),
        "utf8"
      );
    }

    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Не вдалося прочитати дані" });
  }
});

app.post("/api/data", async (req, res) => {
  try {
    if (pool) {
      await pool.query(
        "UPDATE app_data SET data = $1::jsonb WHERE id = 1",
        [JSON.stringify(req.body)]
      );
      return res.json({ ok: true });
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2), "utf8");
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Не вдалося зберегти дані" });
  }
});

async function startServer() {
  try {
    await initDatabase();
  } catch (error) {
    console.error("База недоступна, запускаю застосунок без неї:", error);
    pool = null;
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Час для себе запущено: http://localhost:${PORT}`);
  });
}

startServer();

