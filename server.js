const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/data", (req, res) => {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  res.json(data);
});

app.post("/api/data", (req, res) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2), "utf8");
  res.json({ ok: true });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ADHD Calendar запущено: http://localhost:${PORT}`);
});
