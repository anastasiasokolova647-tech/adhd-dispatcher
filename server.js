const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");
const BOOKS_DATA_FILE = path.join(__dirname, "books-data.json");
const DATABASE_URL = process.env.DATABASE_URL;

let pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) : null;

app.use(express.json());

const BOOK_TRACKER_DIR =
  process.env.BOOK_TRACKER_DIR ||
  path.join(os.homedir(), "Downloads", "Трекер прогресу по книгах");

function readBooksData() {
  if (!fs.existsSync(BOOKS_DATA_FILE)) return { books: [] };

  try {
    const value = JSON.parse(fs.readFileSync(BOOKS_DATA_FILE, "utf8"));
    return value && Array.isArray(value.books) ? value : { books: [] };
  } catch {
    return { books: [] };
  }
}

function writeBooksData(value) {
  const clean = value && Array.isArray(value.books) ? value : { books: [] };
  fs.writeFileSync(BOOKS_DATA_FILE, JSON.stringify(clean, null, 2), "utf8");
}

if (fs.existsSync(BOOK_TRACKER_DIR)) {
  app.get("/book-tracker/", (req, res) => {
    const indexPath = path.join(BOOK_TRACKER_DIR, "index.html");
    let html = fs.readFileSync(indexPath, "utf8");

    const bridge = `
<script>
(() => {
  const KEY = "rainbow-books-v02";
  let lastLocal = localStorage.getItem(KEY) || "";

  function localState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || '{"books":[]}');
      return parsed && Array.isArray(parsed.books) ? parsed : { books: [] };
    } catch {
      return { books: [] };
    }
  }

  async function remoteState() {
    const response = await fetch("/api/books", { cache: "no-store" });
    if (!response.ok) return { books: [] };
    return response.json();
  }

  async function pushLocal(value) {
    await fetch("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
  }

  function detectLocalState() {
    const preferred = localState();
    if (preferred.books.length) return preferred;

    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;

      try {
        const parsed = JSON.parse(localStorage.getItem(key) || "");
        if (parsed && Array.isArray(parsed.books) && parsed.books.length) {
          return parsed;
        }
      } catch {}
    }

    return preferred;
  }

  async function reconcile() {
    try {
      const local = detectLocalState();
      const remote = await remoteState();
      const localHasBooks = local.books.length > 0;
      const remoteHasBooks = Array.isArray(remote.books) && remote.books.length > 0;

      if (!remoteHasBooks && localHasBooks) {
        await pushLocal(local);
        lastLocal = JSON.stringify(local);
        return;
      }

      if (remoteHasBooks) {
        const remoteJson = JSON.stringify(remote);
        const localJson = JSON.stringify(local);

        if (remoteJson !== localJson) {
          localStorage.setItem(KEY, remoteJson);
          lastLocal = remoteJson;
          location.reload();
        }
      }
    } catch (error) {
      console.error("Book tracker bridge:", error);
    }
  }

  window.addEventListener("focus", reconcile);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) reconcile();
  });

  setInterval(async () => {
    const current = localStorage.getItem(KEY) || "";
    if (!current || current === lastLocal) return;

    lastLocal = current;
    try {
      const parsed = JSON.parse(current);
      if (parsed && Array.isArray(parsed.books)) {
        await pushLocal(parsed);
      }
    } catch {}
  }, 700);

  const syncButton = document.createElement("button");
  syncButton.type = "button";
  syncButton.textContent = "🔄 Передати книги в «Час для себе»";
  syncButton.style.position = "fixed";
  syncButton.style.right = "16px";
  syncButton.style.bottom = "16px";
  syncButton.style.zIndex = "99999";
  syncButton.style.padding = "10px 14px";
  syncButton.style.borderRadius = "14px";
  syncButton.style.border = "1px solid rgba(0,0,0,.18)";
  syncButton.style.background = "#fff";
  syncButton.style.boxShadow = "0 4px 16px rgba(0,0,0,.15)";
  syncButton.onclick = async () => {
    try {
      const local = detectLocalState();
      if (!local.books.length) {
        alert("Не знайшла книги в цьому трекері.");
        return;
      }
      await pushLocal(local);
      alert("Готово: передано книг — " + local.books.length);
    } catch (error) {
      console.error(error);
      alert("Не вдалося передати книги.");
    }
  };
  document.body.appendChild(syncButton);

  reconcile();
})();
</script>
`;

    html = html.includes("</body>")
      ? html.replace("</body>", bridge + "</body>")
      : html + bridge;

    res.type("html").send(html);
  });

  app.use("/book-tracker", express.static(BOOK_TRACKER_DIR));
}

app.use(express.static(path.join(__dirname, "public")));

function isPrivateLanHost(host) {
  if (host === "localhost" || host === "127.0.0.1") return true;

  const parts = String(host).split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;

  if (parts[0] === 10) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

  return false;
}

app.use("/api", (req, res, next) => {
  if (!isPrivateLanHost(req.hostname)) {
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

app.get("/api/books", (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(readBooksData());
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Не вдалося прочитати трекер книг" });
  }
});

app.post("/api/books", (req, res) => {
  try {
    writeBooksData(req.body);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Не вдалося зберегти трекер книг" });
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
    if (fs.existsSync(BOOK_TRACKER_DIR)) {
      console.log(`Трекер книг: http://localhost:${PORT}/book-tracker/`);
    }
  });
}

startServer();

