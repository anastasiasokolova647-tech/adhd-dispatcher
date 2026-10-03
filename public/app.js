let data = { folders: [], tasks: [] };

const typeNames = {
  agreement: "🔁 Регулярне · домовленість",
  externalDeadline: "⏰ Регулярне · дедлайн",
  ownDeadline: "🌱 Регулярне · власний дедлайн",
  oneTime: "⚡ Одноразове"
};

const PUBLIC_STORAGE_KEY = "friendly-dayplanner-data-v1";

const LOCAL_HOSTNAME = window.location.hostname;

function isPrivateLanHost(hostname) {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;

  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;

  if (parts[0] === 10) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

  return false;
}

const IS_LOCAL_APP = isPrivateLanHost(LOCAL_HOSTNAME);
const IS_PUBLIC_APP = !IS_LOCAL_APP;

const BOOK_TRACKER_CATS = [
  { key: "plot", label: "Сюжет" },
  { key: "video", label: "Відео" },
  { key: "obsidian", label: "Obsidian" },
  { key: "music", label: "Музика" },
];

async function loadBookTracker() {
  if (IS_PUBLIC_APP) return { books: [] };

  const response = await fetch("/api/books", { cache: "no-store" });
  if (!response.ok) throw new Error("Не вдалося завантажити трекер книг");

  const tracker = await response.json();
  return tracker && Array.isArray(tracker.books) ? tracker : { books: [] };
}

async function saveBookTracker(tracker) {
  if (IS_PUBLIC_APP) return;

  const response = await fetch("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tracker),
  });

  if (!response.ok) throw new Error("Не вдалося зберегти трекер книг");
}

function getBookPlannerFields(book) {
  const valid = new Set(BOOK_TRACKER_CATS.map((cat) => cat.key));
  const fields = Array.isArray(book.plannerFields)
    ? book.plannerFields.filter((key) => valid.has(key))
    : [];
  return fields.length ? fields : BOOK_TRACKER_CATS.map((cat) => cat.key);
}

function bookExcerptDone(excerpt, fields) {
  return fields.every((key) => Boolean(excerpt[key]));
}

function bookProgress(book) {
  const fields = BOOK_TRACKER_CATS.map((cat) => cat.key);
  if (!book.excerpts?.length) return 0;

  const total = book.excerpts.length * fields.length;
  const done = book.excerpts.reduce(
    (sum, excerpt) => sum + fields.filter((key) => excerpt[key]).length,
    0
  );

  return Math.round((done / total) * 1000) / 10;
}

async function ensureBookPlannerSettings(tracker, book) {
  let changed = false;

  if (!["poetry", "prose"].includes(book.plannerKind)) {
    const kind = prompt(
      `"${book.title}" — це:\n1 — Поезія: уривки можна брати навмання\n2 — Проза: тільки по порядку`,
      "2"
    );

    if (kind === null) return false;
    if (!["1", "2"].includes(kind)) {
      alert("Обери 1 для поезії або 2 для прози.");
      return false;
    }

    book.plannerKind = kind === "1" ? "poetry" : "prose";
    changed = true;
  }

  if (!Array.isArray(book.plannerFields) || !book.plannerFields.length) {
    const menu = BOOK_TRACKER_CATS
      .map((cat, index) => `${index + 1} — ${cat.label}`)
      .join("\n");

    const answer = prompt(
      `Які етапи використовує ця книга?\n${menu}\n\nМожна кілька через кому, наприклад 1,3.`,
      "1,2,3,4"
    );

    if (answer === null) return false;

    const indexes = [
      ...new Set(
        answer
          .split(",")
          .map((part) => Number(part.trim()))
          .filter((n) => n >= 1 && n <= BOOK_TRACKER_CATS.length),
      ),
    ];

    if (!indexes.length) {
      alert("Обери хоча б один етап.");
      return false;
    }

    book.plannerFields = indexes.map((n) => BOOK_TRACKER_CATS[n - 1].key);
    changed = true;
  }

  if (changed) await saveBookTracker(tracker);
  return true;
}

async function syncBookProgressForTask(task) {
  if (IS_PUBLIC_APP || !task?.bookTracker) return;

  const tracker = await loadBookTracker();
  const link = task.bookTracker;
  const book = tracker.books.find((item) => item.id === link.bookId);
  const excerpt = book?.excerpts?.find((item) => item.id === link.excerptId);

  if (!book || !excerpt) return;

  for (const key of link.fields || []) {
    if (BOOK_TRACKER_CATS.some((cat) => cat.key === key)) {
      excerpt[key] = true;
    }
  }

  await saveBookTracker(tracker);
}

async function planBookExcerpt(bookId) {
  if (IS_PUBLIC_APP) return;

  await loadData();

  const tracker = await loadBookTracker();
  const book = tracker.books.find((item) => item.id === bookId && !item.closed);

  if (!book) {
    alert("Не знайшла цю книгу в трекері.");
    return;
  }

  if (!(await ensureBookPlannerSettings(tracker, book))) return;

  const fields = getBookPlannerFields(book);
  const unfinished = (book.excerpts || []).filter(
    (excerpt) => !bookExcerptDone(excerpt, fields),
  );

  if (!unfinished.length) {
    alert(`У "${book.title}" усі уривки вже завершені 💗`);
    return;
  }

  const excerpt =
    book.plannerKind === "poetry"
      ? unfinished[Math.floor(Math.random() * unfinished.length)]
      : (book.excerpts || []).find((item) => !bookExcerptDone(item, fields));

  if (!excerpt) return;

  const remaining = fields.filter((key) => !excerpt[key]);
  const remainingCats = remaining
    .map((key) => BOOK_TRACKER_CATS.find((cat) => cat.key === key))
    .filter(Boolean);

  const menu = remainingCats
    .map((cat, index) => `${index + 1} — ${cat.label}`)
    .join("\n");

  const answer = prompt(
    `📚 ${book.title}\n«${excerpt.title}»\n\nЩо зробимо цього разу?\n${menu}\n\nВведи номери через кому. Enter — усі незавершені етапи.`,
    "",
  );

  if (answer === null) return;

  let chosenFields = remaining;

  if (answer.trim()) {
    const indexes = [
      ...new Set(
        answer
          .split(",")
          .map((part) => Number(part.trim()))
          .filter((n) => n >= 1 && n <= remainingCats.length),
      ),
    ];

    if (!indexes.length) {
      alert("Не зрозуміла вибір етапів.");
      return;
    }

    chosenFields = indexes.map((n) => remainingCats[n - 1].key);
  }

  const labels = chosenFields
    .map((key) => BOOK_TRACKER_CATS.find((cat) => cat.key === key)?.label)
    .filter(Boolean);

  const taskText = `📚 ${book.title} — ${excerpt.title}${
    labels.length ? " · " + labels.join(" + ") : ""
  }`;

  const folder = askInboxFolder(taskText);
  if (!folder) return;

  const task = {
    id: Date.now(),
    folderId: folder.id,
    text: taskText,
    type: "oneTime",
    date: formatLocalDate(new Date()),
    done: false,
    bookTracker: {
      bookId: book.id,
      excerptId: excerpt.id,
      fields: chosenFields,
    },
  };

  data.tasks.push(task);
  await saveData();
  showToday();
}

window.planBookExcerpt = planBookExcerpt;

async function editBookPlannerKind(bookId) {
  if (IS_PUBLIC_APP) return;

  const tracker = await loadBookTracker();
  const book = tracker.books.find((item) => item.id === bookId && !item.closed);

  if (!book) {
    alert("Не знайшла цю книгу в трекері.");
    return;
  }

  const current = book.plannerKind === "poetry" ? "1" : "2";
  const answer = prompt(
    `«${book.title}» — який тип?
1 — Поезія: випадковий незавершений уривок
2 — Проза: строго наступний уривок`,
    current,
  );

  if (answer === null) return;
  if (!["1", "2"].includes(answer.trim())) {
    alert("Обери 1 для поезії або 2 для прози.");
    return;
  }

  book.plannerKind = answer.trim() === "1" ? "poetry" : "prose";
  await saveBookTracker(tracker);
  await showBookQueue();
}

window.editBookPlannerKind = editBookPlannerKind;

async function toggleSharedBookField(bookId, excerptId, field) {
  if (IS_PUBLIC_APP) return;

  const tracker = await loadBookTracker();
  const book = tracker.books.find((item) => String(item.id) === String(bookId));
  const excerpt = book?.excerpts?.find((item) => String(item.id) === String(excerptId));

  if (!book || !excerpt) return;
  if (!BOOK_TRACKER_CATS.some((cat) => cat.key === field)) return;

  excerpt[field] = !Boolean(excerpt[field]);
  await saveBookTracker(tracker);
  await showSharedBookTracker();
}

window.toggleSharedBookField = toggleSharedBookField;

async function showSharedBookTracker() {
  if (IS_PUBLIC_APP) {
    showToday();
    return;
  }

  let tracker;
  try {
    tracker = await loadBookTracker();
  } catch (error) {
    console.error(error);
    alert("Не вдалося прочитати трекер книг.");
    return;
  }

  const books = (tracker.books || []).filter((book) => !book.closed);
  const main = document.querySelector("main");
  main.innerHTML = "";

  const back = document.createElement("button");
  back.textContent = "← Книжкова черга";
  back.onclick = showBookQueue;
  main.appendChild(back);

  const title = document.createElement("h2");
  title.textContent = "📖 Трекер книг";
  main.appendChild(title);

  const intro = document.createElement("p");
  intro.textContent = "Це спільний прогрес для ноутбука й телефона.";
  main.appendChild(intro);

  const wrap = document.createElement("div");
  wrap.className = "shared-book-tracker";
  main.appendChild(wrap);

  if (!books.length) {
    const empty = document.createElement("p");
    empty.textContent = "Поки книг немає.";
    wrap.appendChild(empty);
    return;
  }

  for (const book of books) {
    const details = document.createElement("details");
    details.className = "shared-book-card";

    const summary = document.createElement("summary");
    const name = document.createElement("strong");
    name.textContent = book.title;
    const progress = document.createElement("span");
    progress.textContent = bookProgress(book) + "%";
    summary.append(name, progress);
    details.appendChild(summary);

    const excerpts = document.createElement("div");
    excerpts.className = "shared-book-excerpts";

    if (!(book.excerpts || []).length) {
      const none = document.createElement("p");
      none.textContent = "У цій книзі ще немає уривків.";
      excerpts.appendChild(none);
    } else {
      for (const excerpt of book.excerpts) {
        const row = document.createElement("div");
        row.className = "shared-excerpt-row";

        const excerptTitle = document.createElement("strong");
        excerptTitle.textContent = excerpt.title;
        row.appendChild(excerptTitle);

        const checks = document.createElement("div");
        checks.className = "shared-excerpt-checks";

        for (const cat of BOOK_TRACKER_CATS) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "shared-book-check" + (excerpt[cat.key] ? " is-done" : "");
          button.textContent = (excerpt[cat.key] ? "✅ " : "☐ ") + cat.label;
          button.onclick = () => toggleSharedBookField(book.id, excerpt.id, cat.key);
          checks.appendChild(button);
        }

        row.appendChild(checks);
        excerpts.appendChild(row);
      }
    }

    details.appendChild(excerpts);
    wrap.appendChild(details);
  }
}

window.showSharedBookTracker = showSharedBookTracker;

async function showBookQueue() {
  if (IS_PUBLIC_APP) {
    showToday();
    return;
  }

  await loadData();

  let tracker;
  try {
    tracker = await loadBookTracker();
  } catch (error) {
    console.error(error);
    alert("Не вдалося прочитати книжкову чергу.");
    return;
  }

  const books = (tracker.books || []).filter((book) => !book.closed);

  document.querySelector("main").innerHTML = `
    <h2>📚 Книжкова черга</h2>
    <p>Ти обираєш книгу. Чергу уривків пам’ятає система.</p>
    <p>
      <button onclick="showSharedBookTracker()">📖 Відкрити трекер книг</button>
    </p>

    <div class="book-queue">
      ${
        books.length
          ? books
              .map(
                (book) => `
              <article class="book-queue-card">
                <div>
                  <strong>${escapeInboxHtml(book.title)}</strong>
                  <small>${
                    book.plannerKind === "poetry"
                      ? "🎲 Поезія"
                      : book.plannerKind === "prose"
                        ? "▶️ Проза"
                        : "Тип ще не заданий"
                  } · ${bookProgress(book)}%</small>
                </div>
                <div class="book-queue-actions">
                  <button onclick="planBookExcerpt('${book.id}')">Дай мені уривок</button>
                  <button class="book-kind-edit" onclick="editBookPlannerKind('${book.id}')" title="Змінити тип книги">✏️ Тип</button>
                </div>
              </article>
            `,
              )
              .join("")
          : `
              <p>
                Поки книжкова черга порожня. Відкрий трекер кнопкою вище:
                він сам передасть сюди твої локальні книги.
              </p>
            `
      }
    </div>
  `;
}

window.showBookQueue = showBookQueue;

function setupLocalBookQueue() {
  const button = document.getElementById("bookQueueNav");
  if (button) button.hidden = IS_PUBLIC_APP;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupLocalBookQueue);
} else {
  setupLocalBookQueue();
}

async function loadData() {
  if (IS_PUBLIC_APP) {
    const saved = localStorage.getItem(PUBLIC_STORAGE_KEY);

    data = saved
      ? JSON.parse(saved)
      : { folders: [], tasks: [], inbox: [] };

  } else {
    const response = await fetch("/api/data");
    if (!response.ok) throw new Error("Не вдалося завантажити справи");
    data = await response.json();
  }

  if (normalizeRecurringTaskProgress()) await saveData();
}

async function saveData() {
  if (IS_PUBLIC_APP) {
    localStorage.setItem(PUBLIC_STORAGE_KEY, JSON.stringify(data));
    return;
  }

  const response = await fetch("/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  if (!response.ok) throw new Error("Не вдалося зберегти справу");
}

let reminderAudioContext = null;
let reminderCheckBusy = false;
let reminderMelodyUnlocked = false;
let activeTaskAlarmAudio = null;

const ALARM_MELODY_URL = "/alarm-light-come-home.mp3?v=2";
const reminderMelody = new Audio(ALARM_MELODY_URL);
reminderMelody.preload = "auto";
reminderMelody.loop = true;
reminderMelody.volume = 0.82;
reminderMelody.playsInline = true;

function askTaskChime(task) {
  if (!task.time) {
    task.chime = false;
    delete task.chimedFor;
    return;
  }

  task.chime = confirm(
    "🔔 Це важлива терміноорієнтована справа?\n\nУвімкнути будильник з мелодією у зазначений час?"
  );

  if (!task.chime) delete task.chimedFor;
}

function getReminderAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!reminderAudioContext) reminderAudioContext = new AudioContextClass();
  return reminderAudioContext;
}

async function unlockReminderAudio() {
  const ctx = getReminderAudioContext();
  if (ctx && ctx.state === "suspended") {
    try { await ctx.resume(); } catch {}
  }

  if (reminderMelodyUnlocked) return;

  try {
    reminderMelody.muted = true;
    await reminderMelody.play();
    reminderMelody.pause();
    reminderMelody.currentTime = 0;
    reminderMelody.muted = false;
    reminderMelodyUnlocked = true;
  } catch {
    reminderMelody.muted = false;
  }
}

function scheduleBellTone(ctx, when, frequency, volume = 0.16) {
  const oscillator = ctx.createOscillator();
  const harmonic = ctx.createOscillator();
  const gain = ctx.createGain();
  const harmonicGain = ctx.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, when);

  harmonic.type = "sine";
  harmonic.frequency.setValueAtTime(frequency * 2, when);

  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(volume, when + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.55);

  harmonicGain.gain.setValueAtTime(0.0001, when);
  harmonicGain.gain.exponentialRampToValueAtTime(volume * 0.22, when + 0.02);
  harmonicGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.32);

  oscillator.connect(gain);
  harmonic.connect(harmonicGain);
  gain.connect(ctx.destination);
  harmonicGain.connect(ctx.destination);

  oscillator.start(when);
  harmonic.start(when);
  oscillator.stop(when + 0.58);
  harmonic.stop(when + 0.35);
}

async function playFallbackTaskChime() {
  const ctx = getReminderAudioContext();
  if (!ctx) return false;

  try {
    if (ctx.state === "suspended") await ctx.resume();
    if (ctx.state !== "running") return false;

    const start = ctx.currentTime + 0.02;
    scheduleBellTone(ctx, start, 523.25, 0.13);
    scheduleBellTone(ctx, start + 0.27, 659.25, 0.12);
    scheduleBellTone(ctx, start + 0.54, 783.99, 0.11);
    return true;
  } catch {
    return false;
  }
}

function stopTaskAlarm() {
  if (activeTaskAlarmAudio) {
    try {
      activeTaskAlarmAudio.pause();
      activeTaskAlarmAudio.currentTime = 0;
    } catch {}
    activeTaskAlarmAudio = null;
  }

  if ("vibrate" in navigator) navigator.vibrate(0);
  document.getElementById("taskChimeToast")?.remove();
}

window.stopTaskAlarm = stopTaskAlarm;

async function playTaskChime() {
  stopTaskAlarm();

  try {
    reminderMelody.currentTime = 0;
    reminderMelody.loop = true;
    reminderMelody.volume = 0.82;
    await reminderMelody.play();
    activeTaskAlarmAudio = reminderMelody;

    if ("vibrate" in navigator) {
      navigator.vibrate([120, 100, 120, 500, 120, 100, 120]);
    }

    return true;
  } catch (error) {
    console.warn("Мелодія будильника не запустилася, вмикаю дзинь:", error);

    const playedFallback = await playFallbackTaskChime();
    if (playedFallback && "vibrate" in navigator) {
      navigator.vibrate([80, 70, 80]);
    }
    return playedFallback;
  }
}

function showTaskChimeToast(task) {
  document.getElementById("taskChimeToast")?.remove();

  const toast = document.createElement("div");
  toast.id = "taskChimeToast";
  toast.innerHTML = `
    <div>🔔 <strong>Час:</strong> ${linkifyTaskText(task.text)}</div>
    <button type="button" onclick="stopTaskAlarm()" style="
      margin-top:10px;
      padding:8px 14px;
      border:0;
      border-radius:12px;
      cursor:pointer;
      font:inherit;
    ">Вимкнути будильник</button>
  `;
  toast.style.position = "fixed";
  toast.style.left = "50%";
  toast.style.top = "18px";
  toast.style.transform = "translateX(-50%)";
  toast.style.zIndex = "999999";
  toast.style.maxWidth = "min(88vw, 560px)";
  toast.style.padding = "14px 18px";
  toast.style.borderRadius = "18px";
  toast.style.background = "rgba(255, 248, 252, .96)";
  toast.style.boxShadow = "0 10px 30px rgba(60, 40, 55, .22)";
  toast.style.fontSize = "16px";
  toast.style.textAlign = "center";
  document.body.appendChild(toast);
}

function taskReminderMatchesToday(task, now) {
  return taskOccursOnDate(task, now);
}

async function checkTimedTaskChimes() {
  if (reminderCheckBusy) return;
  reminderCheckBusy = true;

  try {
    await loadData();

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const today = formatLocalDate(now);

    for (const task of data.tasks || []) {
      if (taskDoneOnDate(task, today) || !task.chime || !task.time) continue;
      if (!taskReminderMatchesToday(task, now)) continue;

      const normalizedTime = normalizeTaskTime(task.time);
      if (!normalizedTime) continue;

      const [dueHours, dueMinutesPart] = normalizedTime.split(":").map(Number);
      const dueMinutes = dueHours * 60 + dueMinutesPart;
      if (nowMinutes < dueMinutes) continue;

      const reminderKey = `${today}|${task.time}`;
      if (task.chimedFor === reminderKey) continue;

      const played = await playTaskChime();
      if (!played) continue;

      task.chimedFor = reminderKey;
      showTaskChimeToast(task);
      await saveData();
    }
  } catch (error) {
    console.warn("Перевірка дзинь-дзинь не вдалася:", error);
  } finally {
    reminderCheckBusy = false;
  }
}

document.addEventListener("pointerdown", unlockReminderAudio, { passive: true });
document.addEventListener("keydown", unlockReminderAudio, { passive: true });
window.addEventListener("focus", checkTimedTaskChimes);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkTimedTaskChimes();
});
setInterval(checkTimedTaskChimes, 15000);
setTimeout(checkTimedTaskChimes, 1200);

document.getElementById("homeSaveInbox")?.addEventListener("click", async () => {
  const input = document.getElementById("homeInboxText");
  const text = input.value.trim();
  if (!text) return;

  try {
    await loadData();
    if (!Array.isArray(data.inbox)) data.inbox = [];
    data.inbox.push({ id: Date.now(), text, createdAt: new Date().toISOString() });
    await saveData();
    await showInbox();
  } catch (error) {
    alert("Справу не збережено. Спробуй ще раз після відновлення з’єднання.");
    console.error(error);
  }
});

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
      ? Math.round(tasks.filter(t => taskDoneOnDate(t, taskActionDate(t))).length / tasks.length * 100)
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

function openFolder(id, selectedDate = formatLocalDate(new Date())) {
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
          ? tasks.map(task => `<p>🌸 <strong>${linkifyTaskText(task.text)}</strong></p>`).join("")
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

    <button onclick="addTask(${id}, '${selectedDate}')">➕ Додати справу</button>

    <div>
      ${tasks.length ? tasks.map(task => {
        const occurrenceDate = taskActionDate(task, selectedDate);
        const done = taskDoneOnDate(task, occurrenceDate);
        const celebrated = data.tasks.some(t => t.recurringTaskId === task.id && t.date === occurrenceDate && t.celebratedAt);
        return `
        <p>
          <button onclick="toggleTask(${task.id}, ${id}, '${occurrenceDate}')">${done ? "✅" : "☐"}</button>
          <strong>${typeNames[task.type] || "📝 Стара справа"}</strong>
          ${taskRepeatLabel(task) ? `<small>${taskRepeatLabel(task)} · ${occurrenceDate}</small>` : ""}
          ${(task.type === "externalDeadline" || task.type === "ownDeadline") && task.date
            ? ` · 📅 ${new Date(task.date + "T00:00:00").toLocaleDateString("uk-UA", {
                weekday: "long",
                day: "numeric",
                month: "long"
              })}`
            : ""}
          — ${task.chime ? "🔔 " : ""}${linkifyTaskText(task.text)}
          <button onclick="editTask(${task.id}, ${id}, '${occurrenceDate}')">✏️</button>
          <button onclick="deleteTask(${task.id}, ${id})">🗑️</button>
          ${done && !celebrated ? `<button onclick="celebrateTask(${task.id}, ${id}, '${occurrenceDate}')">🌷 Відсвяткувати</button>` : ""}
        </p>
      `;
      }).join("") : "<p>Тут поки тихо 🐣</p>"}
    </div>
  `;
}

async function celebrateTask(taskId, oldFolderId, occurrenceDate) {
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) return;

  let celebrationFolder = data.folders.find(f => f.celebration);

  if (!celebrationFolder) {
    celebrationFolder = {
      id: Date.now(),
      name: "З чим я вітаю тебе",
      celebration: true
    };
    data.folders.push(celebrationFolder);
  }

  if (getTaskRepeat(task)) {
    const dateKey = occurrenceDate || taskActionDate(task);
    setTaskOccurrenceDone(task, dateKey, true);
    if (!data.tasks.some(t => t.recurringTaskId === task.id && t.date === dateKey && t.celebratedAt)) {
      const completed = {
        ...task,
        id: Date.now(),
        folderId: celebrationFolder.id,
        recurringTaskId: task.id,
        date: dateKey,
        done: true,
        celebratedAt: new Date().toISOString()
      };
      clearTaskRepeat(completed);
      data.tasks.push(completed);
    }
  } else {
    task.folderId = celebrationFolder.id;
    task.done = true;
    task.celebratedAt = new Date().toISOString();
  }
  await syncBookProgressForTask(task);

  await saveData();
  playCelebration();

  setTimeout(() => openFolder(oldFolderId, occurrenceDate), 5000);
}

window.celebrateTask = celebrateTask;

async function addTask(folderId, selectedDate) {
  try {
    await loadData();

    if (!Array.isArray(data.tasks)) data.tasks = [];

    const folder = data.folders.find(f => f.id === folderId);
    if (!folder) {
      alert("Не знайшла папку для цієї справи. Відкрий папку ще раз.");
      return;
    }

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
      if (!askTaskRepeat(task, selectedDate)) return;

      const time = prompt("О котрій годині? Наприклад 9:00 або 18:30", "");
      if (time === null) return;
      const normalizedTime = normalizeTaskTime(time);
      if (!normalizedTime) {
        alert("Напиши час як 9:00 або 18:30.");
        return;
      }

      task.time = normalizedTime;
    }

    if (task.type === "externalDeadline" || task.type === "ownDeadline") {
      const date = prompt(
        "Дата дедлайну у форматі РРРР-ММ-ДД:",
        formatLocalDate(new Date())
      );

      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
        alert("Дата має бути у форматі РРРР-ММ-ДД.");
        return;
      }

      task.date = date.trim();

      const time = prompt(
        "Час (необов'язково). Наприклад 9:00 або 18:30. Можна лишити порожнім:",
        ""
      );

      if (time?.trim()) {
        const normalizedTime = normalizeTaskTime(time);
        if (!normalizedTime) {
          alert("Напиши час як 9:00 або 18:30, або лиши порожнім.");
          return;
        }
        task.time = normalizedTime;
      }
      if (!askTaskRepeat(task, task.date, true)) return;
    }

    if (task.type === "oneTime") {
      const date = prompt(
        "Дата справи (необов'язково) у форматі РРРР-ММ-ДД. Можна лишити порожнім:",
        ""
      );

      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
        alert("Дата має бути у форматі РРРР-ММ-ДД або порожня.");
        return;
      }

      if (date?.trim()) task.date = date.trim();

      const time = prompt(
        "Час (необов'язково). Наприклад 9:00 або 18:30. Можна лишити порожнім:",
        ""
      );

      if (time?.trim()) {
        const normalizedTime = normalizeTaskTime(time);
        if (!normalizedTime) {
          alert("Напиши час як 9:00 або 18:30, або лиши порожнім.");
          return;
        }
        task.time = normalizedTime;
      }
    }

    askTaskChime(task);

    data.tasks.push(task);
    await saveData();

    await loadData();
    const saved = data.tasks.some(t => t.id === task.id);

    if (!saved) {
      throw new Error("Справу не знайдено після збереження");
    }

    openFolder(folderId);
  } catch (error) {
    console.error("Не вдалося додати справу:", error);
    alert("Справу не вдалося додати. Дані не стерті — просто спробуй ще раз.");
  }
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

function linkifyTaskText(text) {
  const source = String(text || "");
  const urlPattern = /(?:https?:\/\/|www\.)[^\s]+/gi;
  let result = "";
  let lastIndex = 0;

  for (const match of source.matchAll(urlPattern)) {
    const start = match.index ?? 0;
    result += escapeInboxHtml(source.slice(lastIndex, start));

    let visible = match[0];
    let trailing = "";

    while (/[.,!?;:)\]]$/.test(visible)) {
      trailing = visible.slice(-1) + trailing;
      visible = visible.slice(0, -1);
    }

    const href = visible.toLowerCase().startsWith("www.")
      ? "https://" + visible
      : visible;

    result += `<a class="task-link" href="${escapeInboxHtml(href)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${escapeInboxHtml(visible)}</a>${escapeInboxHtml(trailing)}`;

    lastIndex = start + match[0].length;
  }

  result += escapeInboxHtml(source.slice(lastIndex));
  return result;
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
              📝 ${linkifyTaskText(item.text)}
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
async function toggleTask(taskId, folderId, occurrenceDate) {
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) return;

  const dateKey = occurrenceDate || taskActionDate(task);
  const done = !taskDoneOnDate(task, dateKey);
  setTaskOccurrenceDone(task, dateKey, done);
  if (done) await syncBookProgressForTask(task);
  await saveData();
  openFolder(folderId, dateKey);
}

window.toggleTask = toggleTask;

function getWeekMonday(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay() === 0 ? 7 : d.getDay();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day + 1);
  return d;
}

function formatLocalDate(date) {
  return date.getFullYear() + "-" +
    String(date.getMonth() + 1).padStart(2, "0") + "-" +
    String(date.getDate()).padStart(2, "0");
}

function parseTaskDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T00:00:00");
  return Number.isFinite(date.getTime()) && formatLocalDate(date) === value ? date : null;
}

function getTaskRepeat(task) {
  if (task.celebratedAt) return "";
  return ["daily", "weekly", "monthly", "yearly"].includes(task.repeat) ? task.repeat : "";
}

function getTaskWeekdays(task) {
  const days = Array.isArray(task.weekdays) && task.weekdays.length
    ? task.weekdays
    : [task.weekday];
  return [...new Set(days.map(Number).filter(day => Number.isInteger(day) && day >= 1 && day <= 7))]
    .sort((a, b) => a - b);
}

function parseTaskWeekdays(value) {
  const input = String(value || "").trim();
  if (!/^[1-7](?:[\s,;]+[1-7])*$/.test(input)) return [];
  return [...new Set(input.split(/[\s,;]+/).map(Number))].sort((a, b) => a - b);
}

function taskOccursOnDate(task, date) {
  const dateKey = formatLocalDate(date);
  const repeat = getTaskRepeat(task);
  if (!repeat) return task.date === dateKey;
  const start = parseTaskDate(task.startDate) || parseTaskDate(task.date);
  if (start && dateKey < formatLocalDate(start)) return false;

  if (repeat === "daily") return true;
  if (repeat === "weekly") return getTaskWeekdays(task).includes(date.getDay() || 7);

  const anchor = parseTaskDate(task.date) || parseTaskDate(task.startDate);
  if (!anchor || dateKey < formatLocalDate(anchor)) return false;
  if (repeat === "yearly" && date.getMonth() !== anchor.getMonth()) return false;
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return date.getDate() === Math.min(anchor.getDate(), lastDay);
}

function taskDoneOnDate(task, dateKey) {
  if (!getTaskRepeat(task)) return Boolean(task.done);
  if (task.completions && Object.prototype.hasOwnProperty.call(task.completions, dateKey)) {
    return task.completions[dateKey] === true;
  }
  return Boolean(parseTaskDate(task.completedThrough) && dateKey <= task.completedThrough);
}

function normalizeRecurringTaskProgress() {
  let changed = false;
  for (const task of data.tasks || []) {
    if (!getTaskRepeat(task)) continue;
    if (!task.completions || typeof task.completions !== "object" || Array.isArray(task.completions)) {
      task.completions = {};
      changed = true;
    }
    // The old global checkmark marked every occurrence complete. Keep that
    // history through today, but allow future occurrences to be completed anew.
    if (task.done) {
      task.completedThrough = task.completedThrough || formatLocalDate(new Date());
      task.done = false;
      changed = true;
    }
  }
  return changed;
}

function setTaskOccurrenceDone(task, dateKey, done) {
  if (getTaskRepeat(task)) {
    if (!task.completions || typeof task.completions !== "object" || Array.isArray(task.completions)) {
      task.completions = {};
    }
    task.completions[dateKey] = done;
    task.done = false;
  } else {
    task.done = done;
  }
}

function taskActionDate(task, selectedDate = formatLocalDate(new Date())) {
  let date = parseTaskDate(selectedDate) || new Date();
  if (!getTaskRepeat(task)) return formatLocalDate(date);
  const start = parseTaskDate(task.startDate) || parseTaskDate(task.date);
  if (start && start > date) date = start;
  for (let offset = 0; offset <= 366; offset++) {
    if (taskOccursOnDate(task, date)) return formatLocalDate(date);
    date.setDate(date.getDate() + 1);
  }
  return selectedDate;
}

function taskRepeatLabel(task) {
  return { daily: "Щодня", weekly: "Щотижня", monthly: "Щомісяця", yearly: "Щороку" }[getTaskRepeat(task)] || "";
}

function clearTaskRepeat(task) {
  for (const key of ["repeat", "weekday", "weekdays", "startDate", "completions", "completedThrough"]) delete task[key];
}

function askTaskRepeat(task, selectedDate, allowNone = false) {
  const choices = { "1": "daily", "2": "weekly", "3": "monthly", "4": "yearly" };
  const current = Object.keys(choices).find(key => choices[key] === task.repeat) || (allowNone ? "0" : "2");
  const answer = prompt(
    "Як повторювати справу?\n" + (allowNone ? "0 — Без повтору\n" : "") +
    "1 — Щодня\n2 — Щотижня\n3 — Щомісяця\n4 — Щороку\n\nЯкщо потрібного числа немає в місяці — повтор буде в останній день місяця.",
    current
  );
  if (answer === null) return false;
  if (allowNone && answer.trim() === "0") { clearTaskRepeat(task); return true; }
  const repeat = choices[answer.trim()];
  if (!repeat) { alert("Обери 1, 2, 3 або 4."); return false; }

  let startDate = (allowNone && selectedDate) || task.startDate || selectedDate || formatLocalDate(new Date());
  if (repeat === "weekly") {
    const defaultWeekday = (parseTaskDate(selectedDate) || new Date()).getDay() || 7;
    const currentDays = getTaskWeekdays(task);
    let dayInput = currentDays.length ? currentDays.join(",") : String(defaultWeekday);
    let days;
    while (true) {
      const answerDays = prompt(
        "Дні тижня:\n1 — Понеділок\n2 — Вівторок\n3 — Середа\n4 — Четвер\n5 — П'ятниця\n6 — Субота\n7 — Неділя\n\nМожна кілька днів через кому, наприклад 1,3,5.",
        dayInput
      );
      if (answerDays === null) return false;
      days = parseTaskWeekdays(answerDays);
      if (days.length) break;
      alert("Напиши номери днів від 1 до 7 через кому. Наприклад: 1,3,5.");
      dayInput = answerDays;
    }
    task.weekdays = days;
    task.weekday = days[0];
    delete task.date;
  } else {
    delete task.weekday;
    delete task.weekdays;
    if (repeat === "monthly" || repeat === "yearly") {
      const answerDate = allowNone && parseTaskDate(task.date)
        ? task.date
        : prompt("Дата першого повтору у форматі РРРР-ММ-ДД:", task.date || startDate);
      if (answerDate === null) return false;
      startDate = answerDate.trim();
      if (!parseTaskDate(startDate)) { alert("Напиши дійсну дату у форматі РРРР-ММ-ДД."); return false; }
      task.date = startDate;
    } else {
      delete task.date;
    }
  }
  task.repeat = repeat;
  task.startDate = startDate;
  if (!task.completions) task.completions = {};
  task.done = false;
  return true;
}

function normalizeTaskTime(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "";

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return "";
  return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0");
}

async function addTaskForDate(dateKey, weekday, returnView) {
  try {
    await loadData();

    if (!Array.isArray(data.tasks)) data.tasks = [];

    const text = prompt("Що треба зробити?");
    if (!text || !text.trim()) return;

    const folder = askInboxFolder(text.trim());
    if (!folder) return;

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
      folderId: folder.id,
      text: text.trim(),
      type: types[answer],
      done: false
    };

    if (task.type === "agreement") {
      if (!askTaskRepeat(task, dateKey)) return;

      const time = prompt("О котрій годині? Наприклад 9:00 або 18:30", "");
      if (time === null) return;
      const normalizedTime = normalizeTaskTime(time);
      if (!normalizedTime) {
        alert("Напиши час як 9:00 або 18:30.");
        return;
      }
      task.time = normalizedTime;
    } else {
      task.date = dateKey;

      const time = prompt(
        "Час (необов'язково). Наприклад 9:00 або 18:30. Можна лишити порожнім:",
        ""
      );

      if (time?.trim()) {
        const normalizedTime = normalizeTaskTime(time);
        if (!normalizedTime) {
          alert("Напиши час як 9:00 або 18:30, або лиши порожнім.");
          return;
        }
        task.time = normalizedTime;
      }
      if (task.type !== "oneTime" && !askTaskRepeat(task, task.date, true)) return;
    }

    askTaskChime(task);

    data.tasks.push(task);
    await saveData();

    await loadData();
    const saved = data.tasks.some(t => t.id === task.id);
    if (!saved) throw new Error("Справу не знайдено після збереження");

    if (returnView === "today") {
      showToday();
    } else if (returnView === "week") {
      showWeek();
    } else {
      showCalendar();
    }
  } catch (error) {
    console.error("Не вдалося додати справу з календаря:", error);
    alert("Справу не вдалося додати. Дані не стерті.");
  }
}

window.addTaskForDate = addTaskForDate;

async function showWeek() {
  await loadData();

  const dayNames = [
    "Понеділок",
    "Вівторок",
    "Середа",
    "Четвер",
    "П'ятниця",
    "Субота",
    "Неділя"
  ];

  const monday = getWeekMonday();

  const sections = dayNames.map((dayName, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);

    const weekday = index + 1;
    const dateKey = formatLocalDate(date);

    const tasks = data.tasks
      .filter(task => taskOccursOnDate(task, date) && !taskDoneOnDate(task, dateKey))
      .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));

    const dateLabel = date.toLocaleDateString("uk-UA", {
      day: "numeric",
      month: "short"
    });

    return `
      <section>
        <h3>${dayName} · ${dateLabel}</h3>
        <button class="inline-add-task" onclick="addTaskForDate('${dateKey}', ${weekday}, 'week')">➕ Додати</button>
        <div>
          ${tasks.length
            ? tasks.map(task => `
                <p>
                  <button onclick="toggleWeekTask(${task.id}, '${dateKey}')">☐</button>
                  ${task.chime ? "🔔 " : ""}${task.time ? `<strong>${task.time}</strong> — ` : ""}
                  ${linkifyTaskText(task.text)}
                  <small>${taskRepeatLabel(task) || typeNames[task.type] || ""}</small>
                </p>
              `).join("")
            : "<p>Тут поки тихо 🌿</p>"
          }
        </div>
      </section>
    `;
  }).join("");

  document.querySelector("main").innerHTML = `
    <h2>🗓 Тиждень</h2>
    ${sections}
  `;
}

window.showWeek = showWeek;

async function toggleWeekTask(taskId, occurrenceDate = formatLocalDate(new Date())) {
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) return;

  setTaskOccurrenceDone(task, occurrenceDate, true);
  await syncBookProgressForTask(task);
  await saveData();
  showWeek();
}

window.toggleWeekTask = toggleWeekTask;


let calendarCursor = new Date();

function calendarTaskMatchesDate(task, date) {
  return taskOccursOnDate(task, date);
}

async function showCalendar(year, month) {
  await loadData();

  if (Number.isInteger(year) && Number.isInteger(month)) {
    calendarCursor = new Date(year, month, 1);
  } else {
    calendarCursor = new Date(
      calendarCursor.getFullYear(),
      calendarCursor.getMonth(),
      1
    );
  }

  const yearValue = calendarCursor.getFullYear();
  const monthValue = calendarCursor.getMonth();
  const firstDay = new Date(yearValue, monthValue, 1);
  const lastDay = new Date(yearValue, monthValue + 1, 0);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const totalCells = Math.ceil((mondayOffset + lastDay.getDate()) / 7) * 7;
  const todayKey = formatLocalDate(new Date());

  const monthTitle = calendarCursor.toLocaleDateString("uk-UA", {
    month: "long",
    year: "numeric"
  });

  const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

  const cells = Array.from({ length: totalCells }, (_, index) => {
    const dayNumber = index - mondayOffset + 1;

    if (dayNumber < 1 || dayNumber > lastDay.getDate()) {
      return '<div class="calendar-day calendar-day-empty"></div>';
    }

    const date = new Date(yearValue, monthValue, dayNumber);
    const dateKey = formatLocalDate(date);

    const tasks = data.tasks
      .filter(task => calendarTaskMatchesDate(task, date))
      .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));

    const taskHtml = tasks.length
      ? tasks.map(task => {
          const folder = data.folders.find(f => f.id === task.folderId);
          const folderName = folder?.name || "Без папки";
          const done = taskDoneOnDate(task, dateKey);
          return `
            <div
              class="calendar-task ${done ? "calendar-task-done" : ""}"
              onclick="openFolder(${task.folderId}, '${dateKey}')"
              onkeydown="if(event.target===this&&(event.key==='Enter'||event.key===' ')){event.preventDefault();openFolder(${task.folderId}, '${dateKey}')}"
              role="button"
              tabindex="0"
              title="${escapeInboxHtml(folderName)}"
            >
              ${done ? "✅ " : ""}
              ${task.chime ? "🔔 " : ""}${task.time ? `<strong>${task.time}</strong> ` : ""}
              ${linkifyTaskText(task.text)}
              <small>${escapeInboxHtml(folderName)}${taskRepeatLabel(task) ? " · " + taskRepeatLabel(task) : ""}</small>
            </div>
          `;
        }).join("")
      : "";

    return `
      <div class="calendar-day ${dateKey === todayKey ? "calendar-day-today" : ""}">
        <div class="calendar-date-row">
          <div class="calendar-date">${dayNumber}</div>
          <button
            class="calendar-add-task"
            onclick="addTaskForDate('${dateKey}', ${date.getDay() === 0 ? 7 : date.getDay()}, 'calendar')"
            title="Додати справу на цей день"
            aria-label="Додати справу на ${dayNumber} число"
          >＋</button>
        </div>
        <div class="calendar-tasks">${taskHtml}</div>
      </div>
    `;
  }).join("");

  document.querySelector("main").innerHTML = `
    <div class="calendar-header">
      <button onclick="changeCalendarMonth(-1)" aria-label="Попередній місяць">←</button>
      <h2>📅 ${monthTitle}</h2>
      <button onclick="changeCalendarMonth(1)" aria-label="Наступний місяць">→</button>
    </div>

    <button class="calendar-today-button" onclick="goCalendarToday()">Сьогодні</button>

    <div class="calendar-scroll">
      <div class="calendar-grid calendar-weekdays">
        ${weekdays.map(day => `<div>${day}</div>`).join("")}
      </div>
      <div class="calendar-grid">
        ${cells}
      </div>
    </div>
  `;
}

window.showCalendar = showCalendar;

function changeCalendarMonth(delta) {
  calendarCursor = new Date(
    calendarCursor.getFullYear(),
    calendarCursor.getMonth() + delta,
    1
  );
  showCalendar();
}

window.changeCalendarMonth = changeCalendarMonth;

function goCalendarToday() {
  calendarCursor = new Date();
  showCalendar();
}

window.goCalendarToday = goCalendarToday;

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
      if (taskDoneOnDate(task, today)) return false;
      if (getTaskRepeat(task)) return taskOccursOnDate(task, now);
      const isDueOrOverdue = task.date && task.date <= today;
      const isUndated = !task.date && task.type !== "agreement";

      return isDueOrOverdue || isUndated;
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
    <button class="inline-add-task" onclick="addTaskForDate('${today}', ${weekday}, 'today')">➕ Додати на сьогодні</button>

    <div>
      ${todayTasks.length
        ? todayTasks.map(task => `
            <p>
              <button onclick="toggleTodayTask(${task.id})">
                ${task.done ? "✅" : "☐"}
              </button>
              ${task.chime ? "🔔 " : ""}${task.time ? `<strong>${task.time}</strong> — ` : ""}
              ${task.done ? `<s>${linkifyTaskText(task.text)}</s>` : linkifyTaskText(task.text)}
              <small>${taskRepeatLabel(task) || typeNames[task.type] || ""}</small>
            </p>
          `).join("")
        : "<p>На сьогодні справ немає 🌿</p>"
      }
    </div>
  `;
}

window.showToday = showToday;
async function editTask(taskId, folderId, occurrenceDate) {
  await loadData();
  const original = data.tasks.find(t => t.id === taskId);
  if (!original) return;
  const task = { ...original };

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
    if (!askTaskRepeat(task, occurrenceDate)) return;

    const time = prompt("Час:", task.time || "");
    if (time === null) return;
    const normalizedTime = normalizeTaskTime(time);
    if (!normalizedTime) {
      alert("Напиши час як 9:00 або 18:30.");
      return;
    }

    task.time = normalizedTime;
    askTaskChime(task);
  } else {
    const date = prompt(
      "Дата справи у форматі РРРР-ММ-ДД:",
      task.date || formatLocalDate(new Date())
    );

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return;

    const time = prompt(
      "Час (необов'язково). Наприклад 9:00 або 18:30. Можна лишити порожнім:",
      task.time || ""
    );

    task.date = date.trim();
    if (task.type === "oneTime") clearTaskRepeat(task);

    if (time?.trim()) {
      const normalizedTime = normalizeTaskTime(time);
      if (!normalizedTime) {
        alert("Напиши час як 9:00 або 18:30, або лиши порожнім.");
        return;
      }
      task.time = normalizedTime;
    } else {
      delete task.time;
    }

    if (task.type !== "oneTime" && !askTaskRepeat(task, task.date, true)) return;
    askTaskChime(task);
  }

  delete task.chimedFor;
  data.tasks = data.tasks.map(t => t.id === taskId ? task : t);
  await saveData();
  openFolder(folderId, occurrenceDate);
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

  setTaskOccurrenceDone(task, formatLocalDate(new Date()), true);
  await syncBookProgressForTask(task);
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


function showCalmCorner() {
  document.querySelector("main").innerHTML = `
    <h2>🕯️ Закуток спокою</h2>
    <p>Тут можна трохи видихнути. Нічого не треба вирішувати прямо зараз.</p>

    <h3>🌿 Довший видих</h3>
    <p>Нехай вдих буде звичайним.</p>
    <p>Видихни трохи повільніше й довше.</p>
    <p>Наступний вдих нехай прийде сам.</p>

    <hr>

    <h3>〰️ Дихання по лінії</h3>
    <p>Поведи поглядом уздовж уявної лінії.</p>
    <p>В один бік — вдих.</p>
    <p>Назад — м’який довший видих.</p>

    <hr>

    <h3>🌙 Коли глибокий вдих не хочеться</h3>
    <p>Не треба вдихати глибоко.</p>
    <p>Можна просто трохи подовжити видих і дати тілу самому набрати наступне повітря.</p>
  `;
}

window.showCalmCorner = showCalmCorner;
