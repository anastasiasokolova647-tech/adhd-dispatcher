let data = { folders: [], tasks: [] };

const typeNames = {
  agreement: "🔁 Регулярне · домовленість",
  externalDeadline: "⏰ Регулярне · дедлайн",
  ownDeadline: "🌱 Регулярне · власний дедлайн",
  oneTime: "⚡ Одноразове"
};

const PUBLIC_STORAGE_KEY = "friendly-dayplanner-data-v1";

const IS_PUBLIC_APP =
  window.location.hostname !== "localhost" &&
  window.location.hostname !== "127.0.0.1";

async function loadData() {
  if (IS_PUBLIC_APP) {
    const saved = localStorage.getItem(PUBLIC_STORAGE_KEY);

    data = saved
      ? JSON.parse(saved)
      : { folders: [], tasks: [], inbox: [] };

    return;
  }

  const response = await fetch("/api/data");
  data = await response.json();
}

async function saveData() {
  if (IS_PUBLIC_APP) {
    localStorage.setItem(PUBLIC_STORAGE_KEY, JSON.stringify(data));
    return;
  }

  await fetch("/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
}

async function showFolders() {
  await loadData();

  document.querySelector("main").innerHTML = `
    <h2>📁 Мої папки</h2>
    <button id="newFolder">➕ Нова папка</button>
    <div id="folderList"></div>
  `;

  renderFolders();

  document.getElementById("newFolder").onclick = async () => {
    const name = prompt("Як назвати папку?");
    if (!name || !name.trim()) return;

    data.folders.push({
      id: Date.now(),
      name: name.trim()
    });

    await saveData();
    renderFolders();
  };
}

function renderFolders() {
  const list = document.getElementById("folderList");

  if (!data.folders.length) {
    list.innerHTML = "<p>Поки порожньо. Створи першу папку 🌱</p>";
    return;
  }

  list.innerHTML = data.folders.map(folder => {
    if (folder.celebration) {
      const celebrated = data.tasks.filter(t => t.folderId === folder.id).length;
      return `
        <p>
          <button onclick="openFolder(${folder.id})">🌷 ${folder.name}</button>
          💗 ${celebrated} великих завершень
        </p>
      `;
    }

    const tasks = data.tasks.filter(t => t.folderId === folder.id);
    const progress = tasks.length
      ? Math.round(tasks.filter(t => t.done).length / tasks.length * 100)
      : 0;

    return `
      <p>
        <button onclick="openFolder(${folder.id})">📁 ${folder.name}</button>
        📊 ${progress}% · ${tasks.length} завдань
        <button onclick="renameFolder(${folder.id})">✏️</button>
        <button onclick="deleteFolder(${folder.id})">🗑️</button>
      </p>
    `;
  }).join("");
}

function openFolder(id) {
  const folder = data.folders.find(f => f.id === id);
  if (!folder) return;

  const tasks = data.tasks.filter(task => task.folderId === id);

  if (folder.celebration) {
    document.querySelector("main").innerHTML = `
      <button onclick="showFolders()">← Папки</button>
      <h2>🌷 ${folder.name}</h2>
      <p>Тут живе те велике, що ти вже довела до завершення. 💗</p>

      <div>
        ${tasks.length
          ? tasks.map(task => `<p>🌸 <strong>${task.text}</strong></p>`).join("")
          : "<p>Сад поки чекає на свою першу квітку 🌱</p>"
        }
      </div>
    `;

    playCelebration();
    return;
  }

  document.querySelector("main").innerHTML = `
    <button onclick="showFolders()">← Папки</button>
    <h2>📁 ${folder.name}</h2>

    <button onclick="addTask(${id})">➕ Додати справу</button>

    <div>
      ${tasks.length ? tasks.map(task => `
        <p>
          <button onclick="toggleTask(${task.id}, ${id})">${task.done ? "✅" : "☐"}</button>
          <strong>${typeNames[task.type] || "📝 Стара справа"}</strong>
          ${(task.type === "externalDeadline" || task.type === "ownDeadline") && task.date
            ? ` · 📅 ${new Date(task.date + "T00:00:00").toLocaleDateString("uk-UA", {
                weekday: "long",
                day: "numeric",
                month: "long"
              })}`
            : ""}
          — ${task.text}
          <button onclick="editTask(${task.id}, ${id})">✏️</button>
          <button onclick="deleteTask(${task.id}, ${id})">🗑️</button>
          ${task.done ? `<button onclick="celebrateTask(${task.id}, ${id})">🌷 Відсвяткувати</button>` : ""}
        </p>
      `).join("") : "<p>Тут поки тихо 🐣</p>"}
    </div>
  `;
}

async function celebrateTask(taskId, oldFolderId) {
  const task = data.tasks.find(t => t.id === taskId);
  const celebrationFolder = data.folders.find(f => f.celebration);

  if (!task || !celebrationFolder) return;

  task.folderId = celebrationFolder.id;
  task.done = true;
  task.celebratedAt = new Date().toISOString();

  await saveData();
  playCelebration();

  setTimeout(() => openFolder(oldFolderId), 5000);
}

window.celebrateTask = celebrateTask;async function addTask(folderId) {
  const text = prompt("Що треба зробити?");
  if (!text || !text.trim()) return;

  const answer = prompt(
    "Тип справи:\n1 — Регулярне: домовленість\n2 — Регулярне: дедлайн\n3 — Регулярне: власний дедлайн\n4 — Одноразове",
    "4"
  );

  const types = {
    "1": "agreement",
    "2": "externalDeadline",
    "3": "ownDeadline",
    "4": "oneTime"
  };

  if (!types[answer]) {
    alert("Обери 1, 2, 3 або 4.");
    return;
  }

  const task = {
    id: Date.now(),
    folderId,
    text: text.trim(),
    type: types[answer],
    done: false
  };

  if (task.type === "agreement") {
    const day = prompt(
      "День тижня:\n1 — Понеділок\n2 — Вівторок\n3 — Середа\n4 — Четвер\n5 — П'ятниця\n6 — Субота\n7 — Неділя"
    );

    if (!["1","2","3","4","5","6","7"].includes(day)) return;

    const time = prompt("О котрій годині? Наприклад 19:00", "19:00");
    if (!time || !/^\d{2}:\d{2}$/.test(time.trim())) return;

    task.repeat = "weekly";
    task.weekday = Number(day);
    task.time = time.trim();
  }

  if (task.type === "externalDeadline" || task.type === "ownDeadline") {
    const date = prompt(
      "Дата дедлайну у форматі РРРР-ММ-ДД:",
      new Date().toISOString().slice(0, 10)
    );

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return;
    task.date = date.trim();
  }

  data.tasks.push(task);
  await saveData();
  openFolder(folderId);
}
async function renameFolder(id) {
  const folder = data.folders.find(f => f.id === id);
  if (!folder) return;

  const name = prompt("Нова назва папки:", folder.name);
  if (!name || !name.trim()) return;

  folder.name = name.trim();
  await saveData();
  renderFolders();
}

async function deleteFolder(id) {
  const folder = data.folders.find(f => f.id === id);
  if (!folder) return;

  if (!confirm(`Видалити папку "${folder.name}"?`)) return;

  data.folders = data.folders.filter(f => f.id !== id);
  await saveData();
  renderFolders();
}

window.showFolders = showFolders;
window.openFolder = openFolder;
window.addTask = addTask;
window.renameFolder = renameFolder;
window.deleteFolder = deleteFolder;
function normalizeInboxText(text) {
  return String(text).toLowerCase().replace(/[’ʼ]/g, "'");
}

function escapeInboxHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function looksLikeInboxTask(text) {
  const t = normalizeInboxText(text);

  const emotionalStarts = [
    /^я боюсь\b/,
    /^мені страшно\b/,
    /^я сумую\b/,
    /^мені сумно\b/,
    /^я злюсь\b/,
    /^я втомил/,
    /^я не знаю\b/,
    /^я думаю\b/,
    /^я відчуваю\b/
  ];

  if (emotionalStarts.some(rule => rule.test(t))) return false;

  return /\b(зробити|доробити|написати|записати|прочитати|вивчити|підготувати|купити|замовити|помити|помитись|прибрати|розкласти|попрасувати|зателефонувати|відправити|скинути|перевірити|додати|створити|завантажити|розібрати|розсортувати|оформити|забрати|сходити|поїхати|заплатити|здати|виконати|почистити|винести|приготувати|перейменувати|налаштувати|встановити)\b/i.test(t);
}

function suggestInboxFolder(text) {
  const t = normalizeInboxText(text);

  const rules = [
    {
      name: "Гігієна",
      words: ["помитись", "душ", "зуб", "волос", "гігієн"]
    },
    {
      name: "Учні",
      words: ["аня", "ярік", "наталоч", "учен", "урок", "prepare"]
    },
    {
      name: "Навчання",
      words: ["конспект", "універ", "пара", "дз", "домашн", "лекц", "семінар", "магістрат", "викладач"]
    },
    {
      name: "Книги",
      words: ["книга", "роман", "вірш", "розділ", "аудіокниг", "обкладин", "трейлер", "дівчинк", "крізь ніч", "сад, що слухає", "крила надії"]
    },
    {
      name: "Квартира",
      words: ["квартир", "підлог", "посуд", "ванн", "раковин", "спальн", "коридор", "вітальн", "кухн", "попрас", "білизн", "прибрати"]
    },
    {
      name: "Подорожі",
      words: ["подорож", "поїздк", "маршрут", "готель", "квит", "гідропарк", "заречан"]
    },
    {
      name: "Задумки на проекти",
      words: ["проєкт", "проект", "додаток", "сайт", "диспетчер", "відеомейкер", "фільммейкер", "стабілізатор", "obsidian", "quartz"]
    },
    {
      name: "Що надихає",
      words: ["натхнен", "цитат", "музик", "плейлист", "фото"]
    }
  ];

  const variants = rules
    .map(rule => {
      const folder = data.folders.find(
        f => normalizeInboxText(f.name) === normalizeInboxText(rule.name)
      );

      if (!folder) return null;

      const score = rule.words.reduce(
        (sum, word) => sum + (t.includes(word) ? 1 : 0),
        0
      );

      return { folder, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return variants[0]?.score ? variants[0] : null;
}

function askInboxFolder(text) {
  const folders = data.folders.filter(folder => !folder.celebration);

  const menu = folders
    .map((folder, index) => `${index + 1} — ${folder.name}`)
    .join("\n");

  const answer = prompt(
    `Куди покласти цю справу?\n\n"${text}"\n\n${menu}\n\nСкасування — лишити у Вхідних.`
  );

  if (!answer) return null;

  const index = Number(answer) - 1;

  if (!Number.isInteger(index) || !folders[index]) return null;

  return folders[index];
}

async function sortInboxItem(itemId, forcePick = false) {
  const item = data.inbox.find(x => x.id === itemId);
  if (!item) return false;

  if (!forcePick && !looksLikeInboxTask(item.text)) {
    return false;
  }

  let folder = null;

  if (forcePick) {
    folder = askInboxFolder(item.text);
  } else {
    const suggestion = suggestInboxFolder(item.text);

    if (suggestion && suggestion.score >= 2) {
      folder = suggestion.folder;
    } else if (suggestion && suggestion.score === 1) {
      const yes = confirm(
        `Схоже, це завдання для папки "${suggestion.folder.name}". Перенести?`
      );

      if (yes) {
        folder = suggestion.folder;
      } else {
        return false;
      }
    } else {
      folder = askInboxFolder(item.text);
    }
  }

  if (!folder) return false;

  data.tasks.push({
    id: Date.now(),
    folderId: folder.id,
    text: item.text,
    type: "oneTime",
    done: false
  });

  data.inbox = data.inbox.filter(x => x.id !== item.id);

  await saveData();
  return true;
}

window.sortInboxItem = sortInboxItem;

async function deleteInboxItem(itemId) {
  const item = data.inbox.find(x => x.id === itemId);
  if (!item) return;

  if (!confirm(`Видалити "${item.text}" із Вхідних?`)) return;

  data.inbox = data.inbox.filter(x => x.id !== itemId);

  await saveData();
  showInbox();
}

window.deleteInboxItem = deleteInboxItem;

async function showInbox() {
  await loadData();

  if (!data.inbox) data.inbox = [];

  document.querySelector("main").innerHTML = `
    <h2>🧠 Вивантажити з голови</h2>
    <p>Не розбирай зараз. Просто викинь сюди.</p>

    <textarea id="inboxText" rows="5" placeholder="Що зараз крутиться в голові?"></textarea>
    <br>
    <button id="saveInbox">📥 Зберегти у Вхідні</button>

    <h3>Вхідні</h3>
    <div id="inboxList">
      ${data.inbox.length
        ? data.inbox.slice().reverse().map(item => `
            <p>
              📝 ${escapeInboxHtml(item.text)}
              <button onclick="sortInboxItem(${item.id}, true)">🧭 Розібрати</button>
              <button onclick="deleteInboxItem(${item.id})">🗑️ Видалити</button>
            </p>
          `).join("")
        : "<p>Тут порожньо 🌿</p>"
      }
    </div>
  `;

  document.getElementById("saveInbox").onclick = async () => {
    const input = document.getElementById("inboxText");
    const text = input.value.trim();

    if (!text) return;

    const item = {
      id: Date.now(),
      text,
      createdAt: new Date().toISOString()
    };

    data.inbox.push(item);

    const moved = await sortInboxItem(item.id);

    if (!moved) {
      await saveData();
    }

    showInbox();
  };
}

window.showInbox = showInbox;
async function deleteTask(taskId, folderId) {
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) return;

  if (!confirm(`Видалити справу "${task.text}"?`)) return;

  data.tasks = data.tasks.filter(t => t.id !== taskId);
  await saveData();
  openFolder(folderId);
}

window.deleteTask = deleteTask;
async function toggleTask(taskId, folderId) {
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) return;

  task.done = !task.done;
  await saveData();
  openFolder(folderId);
}

window.toggleTask = toggleTask;
async function showToday() {
  await loadData();

  const now = new Date();
  const weekday = now.getDay() === 0 ? 7 : now.getDay();

  const today =
    now.getFullYear() + "-" +
    String(now.getMonth() + 1).padStart(2, "0") + "-" +
    String(now.getDate()).padStart(2, "0");

  const todayTasks = data.tasks
    .filter(task => {
      const isDatedToday = task.date === today;
      const isWeeklyToday =
        task.type === "agreement" &&
        task.repeat === "weekly" &&
        task.weekday === weekday;

      const isDueOrOverdue = task.date && task.date <= today;
      const isUndated = !task.date && task.type !== "agreement";

      return (isDueOrOverdue || isUndated || isWeeklyToday) && !task.done;
    })
    .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));

  const dateText = now.toLocaleDateString("uk-UA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  document.querySelector("main").innerHTML = `
    <h2>☀️ Сьогодні</h2>
    <h3>${dateText}</h3>

    <div>
      ${todayTasks.length
        ? todayTasks.map(task => `
            <p>
              <button onclick="toggleTodayTask(${task.id})">
                ${task.done ? "✅" : "☐"}
              </button>
              ${task.time ? `<strong>${task.time}</strong> — ` : ""}
              ${task.done ? `<s>${task.text}</s>` : task.text}
              <small>${typeNames[task.type] || ""}</small>
            </p>
          `).join("")
        : "<p>На сьогодні справ немає 🌿</p>"
      }
    </div>
  `;
}

window.showToday = showToday;
async function editTask(taskId, folderId) {
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) return;

  const text = prompt("Текст справи:", task.text);
  if (!text || !text.trim()) return;

  const currentType = {
    agreement: "1",
    externalDeadline: "2",
    ownDeadline: "3",
    oneTime: "4"
  }[task.type] || "4";

  const answer = prompt(
    "Тип справи:\n1 — Регулярне: домовленість\n2 — Регулярне: дедлайн\n3 — Регулярне: власний дедлайн\n4 — Одноразове",
    currentType
  );

  const types = {
    "1": "agreement",
    "2": "externalDeadline",
    "3": "ownDeadline",
    "4": "oneTime"
  };

  if (!types[answer]) return;

  task.text = text.trim();
  task.type = types[answer];

  if (task.type === "agreement") {
    const day = prompt(
      "Обери день:\n1 — Понеділок\n2 — Вівторок\n3 — Середа\n4 — Четвер\n5 — П'ятниця\n6 — Субота\n7 — Неділя",
      String(task.weekday || 1)
    );

    if (!["1","2","3","4","5","6","7"].includes(day)) return;

    const time = prompt("Час:", task.time || "19:00");
    if (!time || !/^\d{2}:\d{2}$/.test(time.trim())) return;

    task.repeat = "weekly";
    task.weekday = Number(day);
    task.time = time.trim();
    delete task.date;
  } else {
    const date = prompt(
      "Дата справи у форматі РРРР-ММ-ДД:",
      task.date || new Date().toISOString().slice(0, 10)
    );

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return;

    task.date = date.trim();
    delete task.repeat;
    delete task.weekday;
    delete task.time;
  }

  await saveData();
  openFolder(folderId);
}

window.editTask = editTask;
async function toggleTodayTask(taskId) {
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) return;

  const heart = document.createElement("div");
  heart.textContent = "💗";
  heart.style.position = "fixed";
  heart.style.left = "50%";
  heart.style.top = "60%";
  heart.style.fontSize = "64px";
  heart.style.zIndex = "99999";
  heart.style.pointerEvents = "none";
  heart.style.transform = "translate(-50%, -50%) scale(0.5)";
  heart.style.opacity = "1";

  document.body.appendChild(heart);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      heart.style.transition = "top 0.8s ease-out, transform 0.8s ease-out, opacity 0.8s ease-out";
      heart.style.top = "25%";
      heart.style.transform = "translate(-50%, -50%) scale(1.8)";
      heart.style.opacity = "0";
    });
  });

  task.done = true;
  await saveData();

  setTimeout(() => {
    heart.remove();
    showToday();
  }, 850);
}

window.toggleTodayTask = toggleTodayTask;
function getAnchorPhraseDate() {
  const now = new Date();
  return now.getFullYear() + "-" +
    String(now.getMonth() + 1).padStart(2, "0") + "-" +
    String(now.getDate()).padStart(2, "0");
}

function loadAnchorPhrase() {
  const el = document.getElementById("anchorPhraseText");
  if (!el) return;

  const key = "anchorPhrase_" + getAnchorPhraseDate();
  const phrase = localStorage.getItem(key);

  el.textContent = phrase || "Торкнись ✏️ і залиш собі фразу на сьогодні";
}

function editAnchorPhrase() {
  const key = "anchorPhrase_" + getAnchorPhraseDate();
  const current = localStorage.getItem(key) || "";

  const phrase = prompt("🌸 Фраза, що тримає сьогодні:", current);
  if (phrase === null) return;

  const clean = phrase.trim();

  if (clean) {
    localStorage.setItem(key, clean);
  } else {
    localStorage.removeItem(key);
  }

  loadAnchorPhrase();
}

window.editAnchorPhrase = editAnchorPhrase;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadAnchorPhrase);
} else {
  loadAnchorPhrase();
}
function playCelebration() {
  const layer = document.createElement("div");
  layer.style.position = "fixed";
  layer.style.inset = "0";
  layer.style.zIndex = "999999";
  layer.style.pointerEvents = "none";
  layer.style.overflow = "hidden";
  document.body.appendChild(layer);

  const symbols = ["💗","💕","🌸","✨","🎉","💖"];

  for (let i = 0; i < 32; i++) {
    const piece = document.createElement("div");
    piece.textContent = symbols[Math.floor(Math.random() * symbols.length)];
    piece.style.position = "absolute";
    piece.style.left = Math.random() * 100 + "%";
    piece.style.top = "-10%";
    piece.style.fontSize = (18 + Math.random() * 24) + "px";
    piece.style.opacity = "1";
    piece.style.transition = `top ${2 + Math.random() * 2}s ease-out, transform 3s ease, opacity 3.5s ease`;
    layer.appendChild(piece);

    setTimeout(() => {
      piece.style.top = (70 + Math.random() * 30) + "%";
      piece.style.transform = `rotate(${Math.random() * 720 - 360}deg)`;
      piece.style.opacity = "0";
    }, 50 + i * 35);
  }

  const flower = document.createElement("div");
  flower.innerHTML = `
    <div style="font-size:70px">🌷</div>
    <div style="margin-top:10px;font-size:22px;font-weight:600">
      З цим я вітаю тебе 💗
    </div>
  `;
  flower.style.position = "absolute";
  flower.style.left = "50%";
  flower.style.bottom = "8%";
  flower.style.textAlign = "center";
  flower.style.color = "#573d4b";
  flower.style.transform = "translateX(-50%) scale(0)";
  flower.style.transformOrigin = "bottom center";
  flower.style.opacity = "0";
  flower.style.padding = "18px 28px";
  flower.style.borderRadius = "24px";
  flower.style.background = "rgba(255,240,246,.82)";
  flower.style.backdropFilter = "blur(10px)";
  flower.style.boxShadow = "0 10px 35px rgba(91,55,72,.18)";
  flower.style.transition = "transform 1.6s cubic-bezier(.2,.9,.3,1.3), opacity .7s ease";
  layer.appendChild(flower);

  setTimeout(() => {
    flower.style.opacity = "1";
    flower.style.transform = "translateX(-50%) scale(1)";
  }, 500);

  setTimeout(() => {
    flower.style.transition = "opacity .7s ease";
    flower.style.opacity = "0";
  }, 4300);

  setTimeout(() => layer.remove(), 5000);
}

window.playCelebration = playCelebration;
