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
    `📚 ${book.title}\n«${escapeInboxHtml(excerpt.title)}»\n\nЩо зробимо цього разу?\n${menu}\n\nВведи номери через кому. Enter — усі незавершені етапи.`,
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

  const taskText = `📚 ${book.title} — ${escapeInboxHtml(excerpt.title)}${
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
let activeReminderTexts = [];

const ALARM_MELODY_URL = "/alarm-light-come-home.mp3?v=2";
const reminderMelody = new Audio(ALARM_MELODY_URL);
reminderMelody.preload = "auto";
reminderMelody.loop = true;
reminderMelody.volume = 0.82;
reminderMelody.playsInline = true;

function askTaskChime(task) {
  if (!getTaskTimes(task).length) {
    task.chime = false;
    delete task.chimedFor;
    delete task.chimedForKeys;
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
    reminderMelody.src = getAlarmMelodyUrl();
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
  activeReminderTexts = [];
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
  if (activeTaskAlarmAudio && !activeTaskAlarmAudio.paused) return true;
  stopTaskAlarm();
  stopComfortSound();
  document.getElementById('lullabyPlayer')?.replaceChildren();
  reminderMelody.src = getAlarmMelodyUrl();

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
  if (!activeReminderTexts.includes(task.text)) activeReminderTexts.push(task.text);
  document.getElementById("taskChimeToast")?.remove();

  const toast = document.createElement("div");
  toast.id = "taskChimeToast";
  toast.innerHTML = `
    <div>🔔 <strong>Час:</strong> ${activeReminderTexts.map(text => linkifyTaskText(text)).join("<br>")}</div>
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
      const taskTimes = getTaskTimes(task);
      if (taskDoneOnDate(task, today) || !task.chime || !taskTimes.length) continue;
      if (!taskReminderMatchesToday(task, now)) continue;

      const chimedKeys = new Set(Array.isArray(task.chimedForKeys) ? task.chimedForKeys : []);
      if (task.chimedFor) chimedKeys.add(task.chimedFor);

      for (const normalizedTime of taskTimes) {
        if (taskTimeDoneOnDate(task, today, normalizedTime)) continue;
        const [dueHours, dueMinutesPart] = normalizedTime.split(":").map(Number);
        const dueMinutes = dueHours * 60 + dueMinutesPart;
        if (nowMinutes < dueMinutes) continue;

        const reminderKey = `${today}|${normalizedTime}`;
        if (chimedKeys.has(reminderKey)) continue;

        const played = await playTaskChime();
        if (!played) continue;

        chimedKeys.add(reminderKey);
        task.chimedFor = reminderKey;
        task.chimedForKeys = [...chimedKeys].filter(key => key.startsWith(`${today}|`));
        showTaskChimeToast(task);
        await saveData();
      }
    }  } catch (error) {
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

  openFolder(oldFolderId, occurrenceDate);
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

      const time = prompt("О котрій годині? Можна кілька: 08:30, 22:00", "");
      if (time === null) return;
      const normalizedTimes = normalizeTaskTimes(time);
      if (!normalizedTimes?.length) {
        alert("Напиши час як 08:30 або кілька через кому: 08:30, 22:00.");
        return;
      }
      task.times = normalizedTimes;
      task.time = normalizedTimes[0];
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

    if (preferredPeriod && ['morning', 'day', 'evening'].includes(preferredPeriod)) {
      task.dayPeriod = preferredPeriod;
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
    `Куди покласти цю справу?\n\n"${text}"\n\n${menu}\n\nВведи номер папки й натисни OK. Скасування — не додавати справу.`
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

function taskTimeDoneOnDate(task, dateKey, time) {
  const times = getTaskTimes(task);
  if (times.length <= 1) return taskDoneOnDate(task, dateKey);

  const normalizedTime = normalizeTaskTime(time);
  if (!normalizedTime) return false;
  const key = `${dateKey}|${normalizedTime}`;

  if (task.timeCompletions && Object.prototype.hasOwnProperty.call(task.timeCompletions, key)) {
    return task.timeCompletions[key] === true;
  }

  return taskDoneOnDate(task, dateKey);
}

function setTaskTimeDone(task, dateKey, time, done) {
  const times = getTaskTimes(task);
  if (times.length <= 1) {
    setTaskOccurrenceDone(task, dateKey, done);
    return;
  }

  if (!task.timeCompletions || typeof task.timeCompletions !== "object" || Array.isArray(task.timeCompletions)) {
    task.timeCompletions = {};
  }

  const normalizedTime = normalizeTaskTime(time);
  if (!normalizedTime) return;

  task.timeCompletions[`${dateKey}|${normalizedTime}`] = done;

  const allDone = times.every(t => task.timeCompletions[`${dateKey}|${t}`] === true);
  setTaskOccurrenceDone(task, dateKey, allDone);
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

function normalizeTaskTimes(value) {
  const parts = String(value || "").split(/[,;]/).map(v => v.trim()).filter(Boolean);
  if (!parts.length) return [];
  const times = parts.map(normalizeTaskTime);
  if (times.some(time => !time)) return null;
  return [...new Set(times)].sort();
}
function getTaskTimes(task) {
  if (Array.isArray(task?.times) && task.times.length) {
    return [...new Set(task.times.map(normalizeTaskTime).filter(Boolean))].sort();
  }

  const time = normalizeTaskTime(task?.time);
  return time ? [time] : [];
}

function getTaskTimeLabel(task) {
  return getTaskTimes(task).join(", ");
}
async function addTaskForDate(dateKey, weekday, returnView, preferredPeriod = null) {
  try {
    await loadData();

    if (!Array.isArray(data.tasks)) data.tasks = [];

    const text = prompt("Що треба зробити?");
    if (!text || !text.trim()) return;

    let folder;
    if (returnView === "today") {
      // The selected day period is not a folder. Prefer an existing task folder
      // and never silently abandon task creation when a numeric prompt fails.
      const folders = data.folders.filter(f => !f.celebration);
      if (!folders.length) {
        alert("Спочатку створи папку у розділі «Мої папки».");
        return;
      }
      folder = folders.length === 1 ? folders[0] : askInboxFolder(text.trim());
    } else {
      folder = askInboxFolder(text.trim());
    }
    if (!folder) {
      alert("Справу не додано: папку не вибрано. Введи номер зі списку папок.");
      return;
    }

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

      const time = prompt("О котрій годині? Можна кілька: 08:30, 22:00", "");
      if (time === null) return;
      const normalizedTimes = normalizeTaskTimes(time);
      if (!normalizedTimes?.length) {
        alert("Напиши час як 08:30 або кілька через кому: 08:30, 22:00.");
        return;
      }
      task.times = normalizedTimes;
      task.time = normalizedTimes[0];
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

    if (returnView === "today" && DAY_PERIODS.some(p => p.id === preferredPeriod)) {
      // Preserve the selected tab even if the task has no time.
      task.dayPeriod = preferredPeriod;
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
                  ${task.chime ? "🔔 " : ""}${getTaskTimeLabel(task) ? `<strong>${getTaskTimeLabel(task)}</strong> — ` : ""}
                  ${linkifyTaskText(task.text)}
                  <small>${taskRepeatLabel(task) || typeNames[task.type] || ""}</small>
                  <button onclick="editWeekTask(${task.id})" title="Редагувати" style="padding:2px 5px; min-width:0; width:auto; font-size:14px; line-height:1; margin-left:6px; vertical-align:middle;">✏️</button>
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
let calendarSelectedDate = "";

function calendarTaskMatchesDate(task, date) {
  return taskOccursOnDate(task, date);
}

function calendarTasksForDate(date) {
  return data.tasks
    .filter(task => calendarTaskMatchesDate(task, date))
    .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
}

function calendarTasksHtml(tasks, dateKey) {
  return tasks.map(task => {
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
        ${task.chime ? "🔔 " : ""}${getTaskTimeLabel(task) ? `<strong>${getTaskTimeLabel(task)}</strong> ` : ""}
        ${linkifyTaskText(task.text)}
        <small>${escapeInboxHtml(folderName)}${taskRepeatLabel(task) ? " · " + taskRepeatLabel(task) : ""}</small>
        <button onclick="event.stopPropagation(); editCalendarTask(${task.id})" title="Редагувати" style="padding:2px 5px; min-width:0; width:auto; font-size:14px; line-height:1; margin-left:6px; vertical-align:middle;">✏️</button>
      </div>
    `;
  }).join("");
}

function showCalendarDay(dateKey) {
  const date = parseTaskDate(dateKey);
  if (!date || formatLocalDate(date) !== dateKey ||
      date.getFullYear() !== calendarCursor.getFullYear() ||
      date.getMonth() !== calendarCursor.getMonth()) return;

  calendarSelectedDate = dateKey;
  const details = document.getElementById("calendarDayDetails");
  if (!details) return;

  document.querySelectorAll(".calendar-select-date").forEach(button => {
    const selected = button.dataset.date === dateKey;
    button.setAttribute("aria-pressed", String(selected));
    button.closest(".calendar-day").classList.toggle("calendar-day-selected", selected);
  });

  const tasks = calendarTasksForDate(date);
  const title = date.toLocaleDateString("uk-UA", {
    weekday: "long", day: "numeric", month: "long"
  });
  details.innerHTML = `
    <h3 id="calendarDayTitle">${title}</h3>
    <button
      class="calendar-add-day-task"
      onclick="addTaskForDate('${dateKey}', ${date.getDay() === 0 ? 7 : date.getDay()}, 'calendar')"
    >＋ Додати справу</button>
    <div class="calendar-tasks">
      ${tasks.length ? calendarTasksHtml(tasks, dateKey) : "<p>На цей день справ немає 🌿</p>"}
    </div>
  `;
}

window.showCalendarDay = showCalendarDay;

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
  const monthKey = formatLocalDate(firstDay).slice(0, 7);

  if (calendarSelectedDate.slice(0, 7) !== monthKey) {
    calendarSelectedDate = todayKey.slice(0, 7) === monthKey
      ? todayKey
      : formatLocalDate(firstDay);
  }

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

    const tasks = calendarTasksForDate(date);
    const taskHtml = calendarTasksHtml(tasks, dateKey);
    const selected = dateKey === calendarSelectedDate;
    const dateLabel = date.toLocaleDateString("uk-UA", { day: "numeric", month: "long" });

    return `
      <div class="calendar-day ${dateKey === todayKey ? "calendar-day-today" : ""} ${selected ? "calendar-day-selected" : ""}">
        <button
          class="calendar-select-date"
          data-date="${dateKey}"
          onclick="showCalendarDay('${dateKey}')"
          aria-pressed="${selected}"
          aria-controls="calendarDayDetails"
          aria-label="${dateLabel}; справ: ${tasks.length}"
        >
          <span>${dayNumber}</span>
          ${tasks.length ? `<span class="calendar-task-count" aria-hidden="true">${tasks.length}</span>` : ""}
        </button>
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

    <p class="calendar-mobile-hint">Торкнись дати — справи з’являться нижче.</p>

    <div class="calendar-scroll">
      <div class="calendar-grid calendar-weekdays">
        ${weekdays.map(day => `<div>${day}</div>`).join("")}
      </div>
      <div class="calendar-grid">
        ${cells}
      </div>
    </div>

    <section id="calendarDayDetails" class="calendar-day-details" aria-labelledby="calendarDayTitle" aria-live="polite"></section>
  `;

  showCalendarDay(calendarSelectedDate);
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
  calendarSelectedDate = formatLocalDate(calendarCursor);
  showCalendar();
}

window.goCalendarToday = goCalendarToday;


// Day parts are presentation-only: existing tasks and their alarms remain unchanged.
const DAY_PERIODS = [
  { id: 'morning', label: '🌅 Ранок' },
  { id: 'day', label: '☀️ День' },
  { id: 'evening', label: '🌙 Вечір' },
  { id: 'flexible', label: '🌿 Без часу' }
];
let selectedDayPeriod = 'morning';

function getTaskDayPeriod(task) {
  const times = getTaskTimes(task);
  if (!times.length) return ['morning', 'day', 'evening'].includes(task.dayPeriod) ? task.dayPeriod : 'flexible';
  const hour = Number(times[0].split(':')[0]);
  if (!Number.isFinite(hour)) return 'flexible';
  return ['morning', 'day', 'evening'].includes(task.dayPeriod) ? task.dayPeriod : (hour < 12 ? 'morning' : hour < 18 ? 'day' : 'evening');
}
function renderDayPeriodTasks(tasks, today) {
  const active = DAY_PERIODS.find(period => period.id === selectedDayPeriod) || DAY_PERIODS[0];
  const matching = tasks.filter(task => getTaskDayPeriod(task) === active.id);
  return matching.length
    ? renderGentleGroups(matching, today)
    : '<p class="gentle-note">Тут поки тихо 🌿</p>';
}
function selectDayPeriod(period) {
  if (!DAY_PERIODS.some(item => item.id === period)) return;
  selectedDayPeriod = period;
  const today = formatLocalDate(new Date());
  const buttons = document.querySelectorAll('.day-period-tabs button');
  buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(DAY_PERIODS[index].id === period)));
  const tasks = data.tasks.filter(task => {
    if (taskDoneOnDate(task, today)) return false;
    if (getTaskRepeat(task)) return taskOccursOnDate(task, new Date());
    return (task.date && task.date <= today) || (!task.date && task.type !== 'agreement');
  }).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  const region = document.getElementById('dayPeriodTasks');
  if (region) region.innerHTML = renderDayPeriodTasks(tasks, today);
}
window.selectDayPeriod = selectDayPeriod;

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

    <div style="margin:12px 0 18px;">
      <button onclick="showBookQueue()" style="width:auto; padding:10px 14px;">
        📖 Уривок для тебе
      </button>
    </div>
    <div class="gentle-actions">
      <button onclick="showSoftStart()">🌱 М’який старт</button>
      <button onclick="showSurprise()">✨ Трохи нового</button>
      <button onclick="showRestRoom()">☁️ Відпочити</button>
    </div>
    <h3>${dateText}</h3>
    <button class="inline-add-task" onclick="addTaskForDate('${today}', ${weekday}, 'today', selectedDayPeriod)">➕ Додати в обрану частину дня</button>

    <div class="day-period-tabs" role="group" aria-label="Частина дня">
      ${DAY_PERIODS.map(period => `<button type="button" aria-pressed="${selectedDayPeriod === period.id}" onclick="selectDayPeriod('${period.id}')">${period.label}</button>`).join('')}
    </div>
    <div id="dayPeriodTasks">
      ${renderDayPeriodTasks(todayTasks, today)}
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
    const normalizedTimes = normalizeTaskTimes(time);
      if (!normalizedTimes?.length) {
        alert("Напиши час як 08:30 або кілька через кому: 08:30, 22:00.");
        return;
      }
      task.times = normalizedTimes;
      task.time = normalizedTimes[0];
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

  if (document.querySelector('.day-period-tabs')) {
    const chosen = prompt('Частина дня: 1 — ранок, 2 — день, 3 — вечір, 4 — без часу', ({morning:'1',day:'2',evening:'3',flexible:'4'})[task.dayPeriod || getTaskDayPeriod(task)] || '4');
    if (chosen !== null) {
      const chosenPeriod = ({'1':'morning','2':'day','3':'evening','4':'flexible'})[chosen];
      if (chosenPeriod) task.dayPeriod = chosenPeriod === 'flexible' ? undefined : chosenPeriod;
    }
  }
  delete task.chimedFor;
  data.tasks = data.tasks.map(t => t.id === taskId ? task : t);
  await saveData();
  openFolder(folderId, occurrenceDate);
}

async function editTodayTask(taskId) {
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) return;
  await editTask(taskId, task.folderId);
  await showToday();
}
window.editTodayTask = editTodayTask;

async function editWeekTask(taskId) {
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) return;
  await editTask(taskId, task.folderId);
  await showWeek();
}
window.editWeekTask = editWeekTask;

async function editCalendarTask(taskId) {
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) return;
  await editTask(taskId, task.folderId);
  await showCalendar();
}
window.editCalendarTask = editCalendarTask;

window.editTask = editTask;
async function toggleTodayTask(taskId, time = null) {
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) return;

  const dateKey = formatLocalDate(new Date());
  if (time) {
    const done = !taskTimeDoneOnDate(task, dateKey, time);
    setTaskTimeDone(task, dateKey, time, done);
  } else {
    setTaskOccurrenceDone(task, dateKey, true);
  }
  await syncBookProgressForTask(task);
  await saveData();

  await showToday();
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
function playCelebration() { /* Completion is a record, not a reward. */ }

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

// Optional comfort settings are separate from task and medication records.
const COMFORT_KEY = 'chas-comfort-v1';
function readComfort() {
  try { return JSON.parse(localStorage.getItem(COMFORT_KEY)) || {}; }
  catch { return {}; }
}
function updateComfort(patch) {
  try {
    localStorage.setItem(COMFORT_KEY, JSON.stringify({ ...readComfort(), ...patch }));
    return true;
  } catch { alert('Не вдалося зберегти. Перевір вільне місце у браузері.'); return false; }
}
function splitGentleGroups(tasks, size = 3) {
  const timed = tasks.filter(t => getTaskTimes(t).length || t.chime);
  const flexible = tasks.filter(t => !getTaskTimes(t).length && !t.chime);
  const groups = [];
  if (timed.length) groups.push({ title: 'У свій час', tasks: timed });
  for (let i = 0; i < flexible.length; i += size) {
    groups.push({ title: `Маленька група ${Math.floor(i / size) + 1}`, tasks: flexible.slice(i, i + size) });
  }
  return groups;
}

// Daily affectionate phrasing keeps the actual task text intact.
const FRIENDLY_TASK_PREFIXES = [
  'Зайчику, ', 'Мася, ', 'Сонечко, ', 'Маленька моя, ',
  'Зіронько, ', 'Рідненька, ', 'Квіточко, ', 'Заюню, '
];
const FRIENDLY_TASK_ENDINGS = [
  ' — як матимеш хвилинку 💗', ' 🌷', ' — потихеньку, без поспіху ☕',
  ' — у своєму темпі 🌿', ' ✨', ' — нехай буде легенько 💛',
  ' — як тобі хочеться 🫶', ' 🌸'
];
const FRIENDLY_TASK_SPECIAL = [
  { pattern: /застелити ліжко|заправити ліжко/i, variants: [
    'Зайчику, ліжечко чекає на твої турботливі ручки 🛏️',
    'Мася, зробимо ліжечку затишно? 🌷',
    'Сонечко, ковдрочка просить маленького порядку 💗',
    'Заюню, час подарувати ліжечку охайний вигляд ✨'
  ] },
  { pattern: /вмитися|умитися|помити обличчя/i, variants: [
    'Зіронько, водичка вже чекає освіжити твої щічки 💧',
    'Зайчику, маленьке ранкове вмивання — і готово 🌸',
    'Мася, ходімо освіжимо личко 💗'
  ] },
  { pattern: /скласти піжаму/i, variants: [
    'Заюню, піжамка проситься на своє місце 🌷',
    'Сонечко, влаштуємо піжамці затишний відпочинок? 💛',
    'Мася, піжамку теж можна вкласти спатоньки ✨'
  ] }
];
function dailyFriendlyIndex(task, dateKey, length, salt = '') {
  const value = String(task.id) + ':' + dateKey + ':' + salt;
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}
function friendlyTaskText(task, dateKey) {
  const text = String(task.text || '').trim();
  if (!text) return '';
  const special = FRIENDLY_TASK_SPECIAL.find(item => item.pattern.test(text));
  if (special) {
    return escapeInboxHtml(special.variants[dailyFriendlyIndex(task, dateKey, special.variants.length, 'special')]);
  }
  const prefix = FRIENDLY_TASK_PREFIXES[dailyFriendlyIndex(task, dateKey, FRIENDLY_TASK_PREFIXES.length, 'prefix')];
  const ending = FRIENDLY_TASK_ENDINGS[dailyFriendlyIndex(task, dateKey, FRIENDLY_TASK_ENDINGS.length, 'ending')];
  const natural = text.charAt(0).toLowerCase() + text.slice(1);
  return escapeInboxHtml(prefix) + linkifyTaskText(natural) + escapeInboxHtml(ending);
}

function renderGentleGroups(tasks, today) {
  if (!tasks.length) return '<p>На сьогодні справ немає 🌿</p>';
  return splitGentleGroups(tasks).map(group => `<section class="gentle-group"><h3>${group.title}</h3>${group.tasks.map(task => `
    <div class="gentle-task">
      <div>${getTaskTimes(task).length > 1
        ? getTaskTimes(task).map(time => `<button aria-label="Відмітити ${time}" onclick="toggleTodayTask(${task.id}, '${time}')">${taskTimeDoneOnDate(task, today, time) ? '✅' : '☐'} <strong>${time}</strong></button>`).join(' ')
        : `<button aria-label="Відмітити виконання" onclick="toggleTodayTask(${task.id})">☐</button> ${getTaskTimeLabel(task) ? `<strong>${getTaskTimeLabel(task)}</strong> — ` : ''}`}
      ${task.chime ? '🔔 ' : ''}${friendlyTaskText(task, today)}
      <small>${taskRepeatLabel(task) || typeNames[task.type] || ''}</small></div>
      <div class="gentle-actions"><button onclick="editTodayTask(${task.id})" aria-label="Редагувати справу">✏️</button>
      ${!getTaskTimes(task).length && !task.chime ? `<button onclick="showTaskChoice(${task.id})">Як мені зручно?</button>` : ''}</div>
    </div>`).join('')}</section>`).join('');
}
function showTaskChoice(id) {
  const task = data.tasks.find(t => t.id === id);
  if (!task) return;
  const saved = readComfort().steps || {};
  document.querySelector('main').innerHTML = `<h2>Свій спосіб</h2><p>${linkifyTaskText(task.text)}</p>
    <p>Можна зробити частину, змінити спосіб або повернутися пізніше. Справу відмічаєш виконаною лише ти.</p>
    <div class="gentle-actions"><button onclick="showSoftStart(${id})">Один маленький крок</button>
    <button onclick="setTaskWay(${id}, 'Спробувати дві хвилини — без обов’язку продовжувати')">Спробувати 2 хвилини</button>
    <button onclick="setTaskWay(${id}, 'Зробити разом з кимось або попросити допомоги')">З допомогою</button>
    <button onclick="setTaskWay(${id}, 'Зробити по-своєму')">По-своєму</button></div>
    <label for="ownStep">Мій посильний варіант</label><textarea id="ownStep" maxlength="1000">${escapeInboxHtml(saved[id] || '')}</textarea>
    <button onclick="saveTaskWay(${id})">Зберегти мій варіант</button><p id="wayStatus" role="status"></p>
    <button onclick="showToday()">Повернутися до дня</button>`;
}
function setTaskWay(id, text) { document.getElementById('ownStep').value = text; }
function saveTaskWay(id) {
  const steps = { ...(readComfort().steps || {}), [id]: document.getElementById('ownStep').value.trim() };
  if (updateComfort({ steps })) document.getElementById('wayStatus').textContent = 'Твій варіант збережено. Розклад справи не змінився.';
}
async function showSoftStart(id = null) {
  await loadData();
  const task = data.tasks.find(t => t.id === id);
  document.querySelector('main').innerHTML = `<h2>🌱 М’який старт</h2>
    <p>Зараз достатньо знайти один доступний рух. Завершувати всю справу не потрібно.</p>
    ${task ? `<p>${linkifyTaskText(task.text)}</p>` : ''}
    <div class="gentle-actions"><button onclick="softStep('Поклади поруч одну потрібну річ. На цьому можна зупинитися.')">Не можу почати</button>
    <button onclick="softStep('Відкрий потрібну сторінку або файл. Поки що просто подивись.')">Забагато всього</button>
    <button onclick="softStep('Обери найменший шматочок, який не потребує підготовки. Або відпочинок.')">Майже немає сил</button></div>
    <p id="softStep" role="status">Обери, що зараз найближче.</p>
    <div class="gentle-actions"><button onclick="showRestRoom()">Мені потрібен відпочинок</button><button onclick="showToday()">Повернутися до справ</button></div>`;
}
function softStep(text) { document.getElementById('softStep').textContent = text; }
const gentleSurprises = [
  'Знайди навколо один відтінок, якого сьогодні ще не помічала.',
  'Придумай назву цьому вечору — наче це розділ твоєї книги.',
  'Обери знайому пісню й послухай лише один інструмент у ній.',
  'Уяви, що на підвіконні живе крихітний дракон. Де він спав би?',
  'Знайди одну річ, до якої приємно торкнутися.',
  'Зміни одну дрібницю у звичній справі, якщо хочеться: місце, чашку чи музику.',
  'Яку маленьку красу сьогодні хотілося б сфотографувати?',
  'Відкрий віконце уяви: який краєвид ти хотіла б зараз бачити?'
];
function showSurprise() {
  const old = readComfort().lastSurprise;
  const choices = gentleSurprises.map((_, i) => i).filter(i => i !== old);
  const index = choices[Math.floor(Math.random() * choices.length)];
  updateComfort({ lastSurprise: index });
  document.querySelector('main').innerHTML = `<h2>✨ Трохи нового</h2><p>Маленька знахідка доступна будь-коли. Її не треба заробляти.</p>
    <p class="surprise-card">${gentleSurprises[index]}</p><div class="gentle-actions"><button onclick="showSurprise()">Щось інше</button><button onclick="showToday()">Залишити на потім</button></div>`;
}
function showRestRoom() {
  document.querySelector('main').innerHTML = `<h2>☁️ Кімната відпочинку</h2><p class="surprise-card">Тут можна просто побути.</p>
    <p>Без відліку й завдань. Тиша теж підходить.</p>
    ${soundControls()}<div class="gentle-actions"><button onclick="showAtmosphere()">Обрати фон</button>
    <button onclick="showCalmCorner()">Закуток спокою</button><button onclick="showToday()">Повернутися, коли захочеться</button></div>
    <p class="gentle-note">Нагадування про ліки й інші справи за часом залишаються увімкненими. Залиш додаток відкритим: закритий браузер не гарантує сигналу.</p>`;
  syncSoundControls();
}
const comfortBackgrounds = {
  original: { name: 'Мій звичний фон', css: '' },
  meadow: { name: 'Трава в сонці', css: 'url(/backgrounds/meadow.webp) center center / cover' },
  dawn: { name: 'Озеро на світанку', css: 'url(/backgrounds/dawn.webp) center center / cover' },
  forest: { name: 'Квітучий сад', css: 'url(/backgrounds/forest.webp) center center / cover' },
  dusk: { name: 'Сад у вечірніх вогниках', css: 'url(/backgrounds/dusk.webp) center center / cover' },
  night: { name: 'Озеро під місяцем', css: 'url(/backgrounds/night.webp) center center / cover' }
};
function applyComfortBackground() {
  const prefs = readComfort();
  let key = prefs.background || 'original';
  if (prefs.autoBackground) {
    const hour = new Date().getHours();
    key = hour < 6 || hour >= 22 ? 'night' : hour < 11 ? 'dawn' : hour < 14 ? 'meadow' : hour < 17 ? 'forest' : 'dusk';
  }
  document.body.style.background = comfortBackgrounds[key]?.css || '';
  document.body.style.backgroundAttachment = 'fixed';
  document.body.classList.toggle('comfort-night', key === 'night');
}
function chooseBackground(key) {
  if (!comfortBackgrounds[key]) return;
  if (updateComfort({ background: key, autoBackground: false })) { applyComfortBackground(); showAtmosphere(); }
}
function toggleAutoBackground(value) {
  if (updateComfort({ autoBackground: value })) applyComfortBackground();
}
function showAtmosphere() {
  const prefs = readComfort();
  document.querySelector('main').innerHTML = `<h2>🎧 Атмосфера</h2><h3>Бібліотека звуків</h3>
    <p>Твої композиції грають повністю. Повтор починається лише після кінця треку. Гучність атмосфери не змінює будильник.</p>${soundControls()}${alarmMelodyControls()}
    <h3>Фони</h3><p>Затишні пейзажі для різного часу доби. Обери свій краєвид або дозволь йому змінюватися разом із днем.</p>
    <div class="background-options">${Object.entries(comfortBackgrounds).map(([key, bg]) => `<button aria-pressed="${!prefs.autoBackground && (prefs.background || 'original') === key}" onclick="chooseBackground('${key}')" class="background-option"><span style="background:${bg.css || 'url(background.png) center / cover'}"></span>${bg.name}</button>`).join('')}</div>
    <label class="gentle-check"><input type="checkbox" ${prefs.autoBackground ? 'checked' : ''} onchange="toggleAutoBackground(this.checked)"> Змінювати фон за часом доби</label>
    <p class="gentle-note">Озеро 06–11 · сонячна трава 11–14 · сад 14–17 · вечір 17–22 · ніч 22–06. Час цього пристрою. Ручний вибір вимикає автоматичний.</p>
    <button onclick="showToday()">До мого дня</button>`;
  syncSoundControls();
}
let comfortAudio = null;
let comfortContext = null;
let comfortSource = null;
let comfortGain = null;
let comfortSound = '';
function soundControls() {
  return `<div class="gentle-actions">${[['rain','Дощ'],['sea','Хвилі'],['warm','М’який шум'], ...Object.entries(comfortMelodies).map(([key, m]) => [key, m.name])].map(([key,label]) => `<button data-comfort-sound="${key}" onclick="playComfortSound('${key}')">${label}</button>`).join('')}<button onclick="stopComfortSound()">Тиша</button></div>
    <label for="comfortVolume">Гучність атмосфери</label><input id="comfortVolume" type="range" min="0" max="0.5" step="0.01" value="${Number(readComfort().volume ?? 0.15)}" oninput="setComfortVolume(this.value)"><p id="soundStatus" role="status"></p><div id="soundPlayer"></div>`;
}
function syncSoundControls(message) {
  const player = document.getElementById('soundPlayer');
  if (player) {
    player.replaceChildren();
    if (comfortAudio) { comfortAudio.controls = true; comfortAudio.setAttribute('aria-label', 'Повна композиція'); player.appendChild(comfortAudio); }
  }
  document.querySelectorAll('[data-comfort-sound]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.comfortSound === comfortSound)));
  const el = document.getElementById('soundStatus');
  if (el) el.textContent = message || (comfortSound ? 'Звук грає. Можна вимкнути будь-коли.' : 'Зараз тихо.');
}
function stopComfortSound() {
  if (comfortAudio) { comfortAudio.pause(); comfortAudio = null; }
  if (comfortSource) { try { comfortSource.stop(); } catch {} comfortSource = null; }
  if (comfortContext) { comfortContext.close().catch(() => {}); comfortContext = null; }
  comfortGain = null; comfortSound = ''; syncSoundControls();
}
function setComfortVolume(value) {
  const volume = Math.max(0, Math.min(0.5, Number(value) || 0));
  updateComfort({ volume });
  if (comfortGain) comfortGain.gain.value = volume;
  if (comfortAudio) comfortAudio.volume = volume;
}
async function playComfortSound(key) {
  stopComfortSound();
  const volume = Number(readComfort().volume ?? 0.15);
  comfortSound = key;
  try {
    if (comfortMelodies[key]) {
      const audio = new Audio(comfortMelodies[key].url);
      comfortAudio = audio; audio.loop = true; audio.volume = volume;
      await audio.play();
      if (comfortAudio !== audio) { audio.pause(); return; }
    } else {
      const AudioClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioClass) throw new Error('Audio unsupported');
      const ctx = new AudioClass(); comfortContext = ctx;
      await ctx.resume();
      if (comfortContext !== ctx) return;
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 8, ctx.sampleRate);
      const samples = buffer.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < samples.length; i++) {
        const noise = Math.random() * 2 - 1;
        brown = (brown + noise * 0.02) / 1.02;
        samples[i] = key === 'rain' ? noise * 0.45 : brown * 3.5 * (key === 'sea' ? 0.55 + 0.45 * Math.sin(2 * Math.PI * i / samples.length) : 1);
      }
      comfortSource = ctx.createBufferSource(); comfortSource.buffer = buffer; comfortSource.loop = true;
      comfortGain = ctx.createGain(); comfortGain.gain.value = volume;
      comfortSource.connect(comfortGain); comfortGain.connect(ctx.destination); comfortSource.start();
    }
    syncSoundControls();
  } catch { stopComfortSound(); syncSoundControls('Не вдалося відтворити звук. Спробуй натиснути ще раз.'); }
}
function showVictories() {
  const victories = readComfort().victories || [];
  document.querySelector('main').innerHTML = `<h2>🌿 Несподівані перемоги</h2><p>Те, що має значення для тебе: попросила допомоги, помітила красиве, вчасно зупинилася. Без балів і серій.</p>
    <label for="victoryText">Що сьогодні хочеться зберегти?</label><textarea id="victoryText" maxlength="2000" placeholder="Мій несподіваний момент…"></textarea>
    <button onclick="addVictory()">Зберегти момент</button><p id="victoryStatus" role="status"></p>
    ${victories.slice().reverse().map(v => `<article class="gentle-group"><small>${escapeInboxHtml(v.date)}</small><p>${escapeInboxHtml(v.text)}</p><button onclick="deleteVictory('${v.id}')">Видалити</button></article>`).join('') || '<p>Тут є місце для твоїх знахідок. Заповнювати щодня не потрібно.</p>'}
    <p class="gentle-note">Колекція та налаштування атмосфери зберігаються в цьому браузері.</p><button onclick="showToday()">До мого дня</button>`;
}
function addVictory() {
  const text = document.getElementById('victoryText').value.trim();
  if (!text) { document.getElementById('victoryStatus').textContent = 'Напиши кілька слів про свій момент.'; return; }
  const victories = [...(readComfort().victories || []), { id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`, date: new Date().toLocaleDateString('uk-UA'), text }];
  if (updateComfort({ victories })) showVictories();
}
function deleteVictory(id) {
  if (confirm('Видалити цей запис із колекції?')) {
    if (updateComfort({ victories: (readComfort().victories || []).filter(v => v.id !== id) })) showVictories();
  }
}
window.addEventListener('load', applyComfortBackground);
setInterval(applyComfortBackground, 60000);

const comfortMelodies = {
  "golden-mercy": {"name": "Golden Mercy", "url": "/sounds/golden-mercy.mp3"},
  "apples-in-the-grass": {"name": "Apples in the Grass", "url": "/sounds/apples-in-the-grass.mp3"},
  "cast-of-small-wonders": {"name": "Cast of Small Wonders", "url": "/sounds/cast-of-small-wonders.mp3"},
  "first-smile-cat": {"name": "First Smile, Cat", "url": "/sounds/first-smile-cat.mp3"},
  "behind-the-fairy-door": {"name": "Behind the Fairy Door", "url": "/sounds/behind-the-fairy-door.mp3"},
  melody: { name: 'Попередній короткий сигнал', url: ALARM_MELODY_URL }
};

function getAlarmMelodyUrl() {
  return comfortMelodies[readComfort().alarmMelody]?.url || comfortMelodies['golden-mercy'].url;
}
function alarmMelodyControls() {
  const selected = readComfort().alarmMelody || 'golden-mercy';
  return `<h3>Мелодія будильника</h3><p>Окремий вибір для всіх нагадувань, зокрема про ліки. Гучність сигналу залишається незмінною.</p>
    <label for="alarmMelody">Обрана мелодія</label><select id="alarmMelody" onchange="chooseAlarmMelody(this.value)">
    ${Object.entries(comfortMelodies).map(([key,m]) => `<option value="${key}" ${key === selected ? 'selected' : ''}>${m.name}</option>`).join('')}</select>
    <div class="gentle-actions"><button onclick="previewAlarmMelody()">Прослухати сигнал</button><button onclick="stopComfortSound()">Зупинити прослуховування</button></div>
    <p id="alarmChoiceStatus" role="status"></p>`;
}
function chooseAlarmMelody(key) {
  if (!comfortMelodies[key]) return;
  if (updateComfort({ alarmMelody: key })) {
    reminderMelodyUnlocked = false;
    document.getElementById('alarmChoiceStatus').textContent = 'Мелодію збережено. Час нагадувань не змінено.';
  }
}
async function previewAlarmMelody() {
  if (activeTaskAlarmAudio) return;
  await playComfortSound(readComfort().alarmMelody || 'golden-mercy');
  if (comfortAudio) { comfortAudio.volume = 0.82; comfortAudio.loop = false; comfortAudio.onended = stopComfortSound; }
}

// The catalogue includes all book excerpts except videos tagged «Крик».
function lullabyEveningKey(now = new Date()) {
  const evening = new Date(now);
  if (now.getHours() < 6) evening.setDate(evening.getDate() - 1);
  return formatLocalDate(evening);
}
const lullabyMoods = {
  chill: {label:'🌿 Мені добре, просто чилю', tags:['Спокій','Радість','Вдячність'], gentle:true},
  sleep: {label:'🌙 Хочу заснути', tags:['Потрібен сон','Сонливість','Відпочинок','Розслаблення','Тіло розслабляється'], gentle:true},
  warmth: {label:'🫂 Хочу тепла й близькості', tags:['Ніжність','Близькість','Обійми','Бути поруч']},
  sad: {label:'🌧 Мені сумно, хочу побути з цим', tags:['Сум','Туга','Плач','Хочеться плакати','Горе']},
  anxious: {label:'🕯 Мені тривожно, хочу підтримки', tags:['Тривога','Страх','Безпека','Приймаю підтримку']},
  tired: {label:'☁️ Я виснажена, хочу перепочити', tags:['Виснаження','Втома','Немає сил','Відпочинок']},
  all: {label:'🍵 Будь-який стан', tags:[]}
};
function currentLullabyMood() {
  const key = readComfort().lullabyMood || 'all';
  return lullabyMoods[key] ? key : 'all';
}
function lullabyPool(mood = currentLullabyMood()) {
  const rule = lullabyMoods[mood] || lullabyMoods.all;
  return lullabyExcerpts.filter(e => {
    const tags = e.tags || [];
    if (rule.tags.length && !rule.tags.some(t => tags.includes(t))) return false;
    // A warm ending does not make a painful scene fit a carefree evening.
    if (rule.gentle && tags.some(t => /біль|бол[яиі]|ран[яи]|плач|сл[ьі]оз|сум|туг[аи]|страх|тривог|горе|втрат|смерт|відча|самот|покин|зрад|гнів|сором|провин|безсил|ненавист|образ|поран|крик|війна|війни/i.test(t))) return false;
    return true;
  });
}
function chooseLullabyMood(mood) {
  if (!lullabyMoods[mood]) return;
  if (updateComfort({lullabyMood:mood, lullabyVideo:'daily', lullabySkip:0})) {
    showLullaby(); updateLullabyInvitation();
  }
}
function anotherLullaby() {
  const prefs = readComfort(), evening = lullabyEveningKey();
  const skip = prefs.lullabySkipEvening === evening ? (prefs.lullabySkip || 0) : 0;
  if (updateComfort({lullabyVideo:'daily',lullabySkip:skip+1,lullabySkipEvening:evening})) {
    showLullaby(); updateLullabyInvitation();
  }
}
function lullabyForEvening(now = new Date()) {
  const prefs = readComfort();
  const pool = lullabyPool();
  if (!pool.length) return null;
  const chosen = pool.find(e => e.video === prefs.lullabyVideo);
  if (chosen) return chosen;
  const date = parseTaskDate(lullabyEveningKey(now));
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  const skip = prefs.lullabySkipEvening === lullabyEveningKey(now) ? (prefs.lullabySkip || 0) : 0;
  return pool[(day + skip) % pool.length];
}
function lullabyIsDue(now, prefs) {
  if (prefs.lullabyEnabled === false) return false;
  const time = /^\d{2}:\d{2}$/.test(prefs.lullabyTime || '') ? prefs.lullabyTime : '22:00';
  const [h,m] = time.split(':').map(Number);
  const minutes = now.getHours()*60 + now.getMinutes();
  return minutes >= h*60+m || minutes < 360;
}
function updateLullabyInvitation() {
  const now = new Date(), prefs = readComfort();
  let card = document.getElementById('lullabyInvitation');
  if (!lullabyIsDue(now,prefs) || prefs.lullabyDismissed === lullabyEveningKey(now)) { card?.remove(); return; }
  if (!card) {
    card = document.createElement('section'); card.id='lullabyInvitation';
    document.querySelector('nav').after(card);
  }
  const excerpt = lullabyForEvening(now);
  if (!excerpt) { card.remove(); return; }
  card.innerHTML = `<strong>🌙 Вечірня колисанка</strong><p>«${escapeInboxHtml(excerpt.title)}» із «Чаю опівночі» — коли захочеш вмоститися зручніше.</p><div class="gentle-actions"><button onclick="showLullaby()">Відкрити уривок</button><button onclick="dismissLullaby()">Сьогодні без нагадування</button></div>`;
}
function dismissLullaby() {
  if (updateComfort({lullabyDismissed:lullabyEveningKey()})) updateLullabyInvitation();
}
function showLullaby() {
  const prefs = readComfort(), excerpt = lullabyForEvening(), mood = currentLullabyMood(), pool = lullabyPool();
  document.querySelector('main').innerHTML = `<h2>🌙 Вечірня колисанка</h2><p>Твій уривок із «Чаю опівночі». Відеоуривків: ${lullabyExcerpts.length}. З усіх книжкових папок, без тегу «Крик».</p>
    <label for="lullabyMood">Як тобі зараз?</label><select id="lullabyMood" onchange="chooseLullabyMood(this.value)">${Object.entries(lullabyMoods).map(([key, value])=>`<option value="${key}" ${key===mood?'selected':''}>${value.label}</option>`).join('')}</select>
    <p class="gentle-note">${mood==='all'?'Уся добірка.':'Добір за тегами твого «Чаю». Уривків для цього стану: '+pool.length+'.'} ${lullabyMoods[mood].gentle?'Без тегів болю, плачу, тривоги та втрати.':''}</p>
    ${excerpt ? `<h3>${escapeInboxHtml(excerpt.title)}</h3><p>${escapeInboxHtml(excerpt.book)} · Анастасія Соколова</p>
    <div id="lullabyPlayer"></div><div class="gentle-actions"><button onclick="playLullaby()">▶ Послухати уривок</button><a href="https://www.youtube.com/watch?v=${excerpt.video}" target="_blank" rel="noopener noreferrer">Відкрити на YouTube</a></div>
    <button onclick="anotherLullaby()" ${pool.length<2?'disabled':''}>↻ Інший уривок у цьому настрої</button>
    <p>Повне відео, без автоматичного запуску й повтору.</p>` : '<p>Для цього стану поки немає уривків. Можеш обрати інший стан.</p>'}
    <label for="lullabyVideo">Що слухати ввечері</label><select id="lullabyVideo" onchange="saveLullabySettings()"><option value="daily">Щовечора інший із добірки</option>${pool.map(e=>`<option value="${e.video}" ${prefs.lullabyVideo===e.video?'selected':''}>${escapeInboxHtml(e.book)} — ${escapeInboxHtml(e.title)}</option>`).join('')}</select>
    <label class="gentle-check"><input id="lullabyEnabled" type="checkbox" ${prefs.lullabyEnabled===false?'':'checked'} onchange="saveLullabySettings()"> Пропонувати колисанку щовечора</label>
    <label for="lullabyTime">Мій вечірній час</label><input id="lullabyTime" type="time" value="${/^\d{2}:\d{2}$/.test(prefs.lullabyTime || '')?prefs.lullabyTime:'22:00'}" onchange="saveLullabySettings()">
    <p class="gentle-note">Запрошення з’являється у відкритому додатку або коли повернешся ввечері. Час цього пристрою. Нагадування про ліки працюють окремо.</p><button onclick="showToday()">До мого дня</button>`;
}
function saveLullabySettings() {
  const time = document.getElementById('lullabyTime').value;
  if (!/^\d{2}:\d{2}$/.test(time)) return;
  if (updateComfort({lullabyEnabled:document.getElementById('lullabyEnabled').checked,lullabyTime:time,lullabyVideo:document.getElementById('lullabyVideo').value})) {
    showLullaby(); updateLullabyInvitation();
  }
}
function playLullaby() {
  if (activeTaskAlarmAudio) return;
  stopComfortSound();
  const excerpt = lullabyForEvening();
  if (!excerpt) return;
  document.getElementById('lullabyPlayer').innerHTML = `<iframe title="${escapeInboxHtml(excerpt.title)}" src="https://www.youtube-nocookie.com/embed/${excerpt.video}" allow="encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
}
window.addEventListener('load',updateLullabyInvitation);
window.addEventListener('focus',updateLullabyInvitation);
setInterval(updateLullabyInvitation,30000);
