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

app.use(express.json({ limit: "20mb" }));

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
    const initialBooksJson = JSON.stringify(readBooksData()).replace(/</g, "\\u003c");

    const livePrelude = `
<script>
(() => {
  try {
    localStorage.setItem("rainbow-books-v02", ${JSON.stringify(initialBooksJson)});
  } catch {}

  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.getRegistrations()
    .then((regs) => regs.forEach((reg) => reg.unregister()))
    .catch(() => {});
  try {
    navigator.serviceWorker.register = () =>
      Promise.reject(new Error("Service worker disabled for live local tracker"));
  } catch {}
})();
</script>
`;

    html = html.includes("</head>")
      ? html.replace("</head>", livePrelude + "</head>")
      : livePrelude + html;

    const bridge = `
<script>
(() => {
  const KEY = "rainbow-books-v02";
  const nativeSetItem = Storage.prototype.setItem;
  let applyingRemote = false;
  let pushing = false;
  let pushTimer = null;
  let lastLocalMutation = 0;

  function localState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || '{"books":[]}');
      return parsed && Array.isArray(parsed.books) ? parsed : { books: [] };
    } catch {
      return { books: [] };
    }
  }

  function detectLocalState() {
    const preferred = localState();
    if (preferred.books.length) return preferred;

    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || "");
        if (parsed && Array.isArray(parsed.books) && parsed.books.length) return parsed;
      } catch {}
    }

    return preferred;
  }

  async function remoteState() {
    const response = await fetch("/api/books", { cache: "no-store" });
    if (!response.ok) throw new Error("books GET failed");
    const value = await response.json();
    return value && Array.isArray(value.books) ? value : { books: [] };
  }

  async function pushLocal(value) {
    pushing = true;
    try {
      const response = await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      if (!response.ok) throw new Error("books POST failed");
    } finally {
      pushing = false;
    }
  }

  function schedulePush(rawValue) {
    clearTimeout(pushTimer);
    lastLocalMutation = Date.now();

    pushTimer = setTimeout(async () => {
      try {
        const parsed = JSON.parse(rawValue || '{"books":[]}');
        if (parsed && Array.isArray(parsed.books)) await pushLocal(parsed);
      } catch (error) {
        console.error("Book tracker live push:", error);
      }
    }, 120);
  }

  Storage.prototype.setItem = function(key, value) {
    nativeSetItem.call(this, key, value);
    if (this === localStorage && key === KEY && !applyingRemote) {
      schedulePush(value);
    }
  };

  async function applyRemoteIfNeeded() {
    if (pushing || Date.now() - lastLocalMutation < 500) return;

    try {
      const local = detectLocalState();
      const remote = await remoteState();
      const localJson = JSON.stringify(local);
      const remoteJson = JSON.stringify(remote);

      if (!remote.books.length && local.books.length) {
        await pushLocal(local);
        return;
      }

      if (remote.books.length && remoteJson !== localJson) {
        applyingRemote = true;
        nativeSetItem.call(localStorage, KEY, remoteJson);
        applyingRemote = false;
        location.reload();
      }
    } catch (error) {
      console.error("Book tracker live pull:", error);
    }
  }

  window.addEventListener("focus", applyRemoteIfNeeded);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) applyRemoteIfNeeded();
  });

  setInterval(applyRemoteIfNeeded, 1200);
  applyRemoteIfNeeded();
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


app.get("/book-sync/", (req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Синхронізація книг</title>
  <style>
    body { font-family: system-ui, sans-serif; background:#f8f6fb; color:#24212c; display:grid; place-items:center; min-height:100vh; margin:0; }
    .card { max-width:520px; margin:24px; background:#fff; border-radius:22px; padding:28px; box-shadow:0 12px 40px rgba(0,0,0,.08); }
    button { border:0; border-radius:14px; padding:12px 16px; font-size:16px; cursor:pointer; background:#7455d9; color:#fff; }
    #status { margin-top:14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>📚 Передати книги</h1>
    <p>Ця сторінка бере книги з локального трекера і передає їх у «Час для себе».</p>
    <button id="sync">🔄 Передати книги</button>
    <p id="status"></p>
  </div>
  <script>
    const KEY = "rainbow-books-v02";
    const status = document.getElementById("status");

    function findBooksState() {
      try {
        const direct = JSON.parse(localStorage.getItem(KEY) || '{"books":[]}');
        if (direct && Array.isArray(direct.books) && direct.books.length) return direct;
      } catch {}

      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        try {
          const parsed = JSON.parse(localStorage.getItem(key) || "");
          if (parsed && Array.isArray(parsed.books) && parsed.books.length) return parsed;
        } catch {}
      }
      return { books: [] };
    }

    document.getElementById("sync").onclick = async () => {
      const state = findBooksState();
      if (!state.books.length) {
        status.textContent = "Не знайшла книг у локальному трекері.";
        return;
      }

      const response = await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state)
      });

      if (!response.ok) {
        status.textContent = "Не вдалося передати книги.";
        return;
      }

      status.textContent = "Готово: передано книг — " + state.books.length;
    };
  </script>
</body>
</html>`);
});

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

