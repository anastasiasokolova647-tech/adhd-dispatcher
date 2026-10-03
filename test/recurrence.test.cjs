const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
const daily = (extra = {}) => ({ id: 11, folderId: 10, text: "Мікроприбирання", type: "agreement", repeat: "daily", startDate: "2026-10-02", time: "08:00", done: false, completions: {}, ...extra });

function app(tasks, answers = []) {
  let clock = new Date(2026, 9, 2, 22, 17);
  let id = 0;
  class AppDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.getTime()])); }
    static now() { return clock.getTime() + id++; }
  }
  const storage = new Map([["friendly-dayplanner-data-v1", JSON.stringify({ folders: [{ id: 10, name: "Квартира" }], inbox: [], tasks })]]);
  const main = { innerHTML: "" };
  const elements = new Map();
  const alerts = [];
  const prompts = [];
  let writes = 0;
  const context = vm.createContext({
    console, Date: AppDate, Audio: class {}, navigator: {},
    window: { location: { hostname: "planner.test" }, addEventListener() {} },
    document: {
      readyState: "loading", addEventListener() {},
      querySelector: s => s === "main" ? main : null,
      getElementById: id => elements.get(id) || null,
      createElement: () => ({ style: {}, remove() { elements.delete(this.id); } }),
      body: { appendChild: e => elements.set(e.id, e) }
    },
    setTimeout() {}, setInterval() {}, requestAnimationFrame() {},
    confirm: () => false,
    alert: text => alerts.push(text),
    prompt(message, value) {
      prompts.push({ message, value });
      assert.ok(answers.length, "Unexpected prompt");
      return answers.shift();
    },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => { storage.set(key, value); writes++; } }
  });
  vm.runInContext(source, context);
  context.playCelebration = () => {};
  context.askInboxFolder = () => ({ id: 10, name: "Квартира" });
  return {
    context, main, alerts, prompts,
    state: () => JSON.parse(vm.runInContext("JSON.stringify(data)", context)),
    saved: () => JSON.parse(storage.get("friendly-dayplanner-data-v1")),
    writes: () => writes,
    setDate: (year, month, day, hours = 22, minutes = 17) => { clock = new Date(year, month - 1, day, hours, minutes); }
  };
}

const on = (context, task, date) => context.taskOccursOnDate(task, context.parseTaskDate(date));

test("daily repeats start on the selected day and continue into the next month", () => {
  const { context } = app([]);
  assert.equal(on(context, daily(), "2026-10-01"), false);
  for (const date of ["2026-10-02", "2026-10-03", "2026-10-04", "2026-11-01"]) assert.equal(on(context, daily(), date), true);
  assert.equal(on(context, daily({ startDate: undefined, date: "2026-10-02" }), "2026-10-01"), false);
});

test("weekly repeats support stored string weekdays and any regular task type", () => {
  const { context } = app([]);
  const task = daily({ type: "ownDeadline", repeat: "weekly", weekday: "5" });
  assert.equal(on(context, task, "2026-10-02"), true);
  assert.equal(on(context, task, "2026-10-03"), false);
  assert.equal(on(context, task, "2026-10-09"), true);
  assert.equal(on(context, daily({ repeat: "weekly", weekday: 7 }), "2026-10-04"), true);
});

test("month-end and leap-day repeats use the last available day", () => {
  const { context } = app([]);
  const monthly = daily({ repeat: "monthly", date: "2026-01-31", startDate: "2026-01-31" });
  assert.equal(on(context, monthly, "2026-02-28"), true);
  assert.equal(on(context, monthly, "2026-03-30"), false);
  assert.equal(on(context, monthly, "2026-03-31"), true);
  assert.equal(on(context, monthly, "2028-02-29"), true);
  const yearly = daily({ repeat: "yearly", date: "2024-02-29", startDate: "2024-02-29" });
  assert.equal(on(context, yearly, "2025-02-28"), true);
  assert.equal(on(context, yearly, "2025-03-29"), false);
  assert.equal(on(context, yearly, "2028-02-29"), true);
});

test("finishing Saturday leaves Friday and Sunday active in the actual views", async () => {
  const a = app([daily()]);
  await a.context.showWeek();
  assert.equal((a.main.innerHTML.match(/Мікроприбирання/g) || []).length, 3);
  assert.ok(a.main.innerHTML.includes("toggleWeekTask(11, '2026-10-03')"));
  await a.context.toggleWeekTask(11, "2026-10-03");
  await a.context.showWeek();
  assert.equal((a.main.innerHTML.match(/Мікроприбирання/g) || []).length, 2);
  const task = a.saved().tasks[0];
  assert.equal(a.context.taskDoneOnDate(task, "2026-10-02"), false);
  assert.equal(a.context.taskDoneOnDate(task, "2026-10-03"), true);
  assert.equal(a.context.taskDoneOnDate(task, "2026-10-04"), false);
  await a.context.showToday();
  assert.ok(a.main.innerHTML.includes("Мікроприбирання"));
  await a.context.showCalendar(2026, 9);
  assert.equal((a.main.innerHTML.match(/Мікроприбирання/g) || []).length, 30);
  assert.equal((a.main.innerHTML.match(/class="calendar-task calendar-task-done"/g) || []).length, 1);
  assert.ok(a.main.innerHTML.includes("openFolder(10, '2026-10-03')"));
});

test("a completed day can be reopened without affecting the rest of the series", async () => {
  const a = app([daily({ completions: { "2026-10-03": true } })]);
  await a.context.loadData();
  await a.context.toggleTask(11, 10, "2026-10-03");
  assert.equal(a.saved().tasks[0].completions["2026-10-03"], false);
  assert.equal(a.context.taskDoneOnDate(a.saved().tasks[0], "2026-10-04"), false);
});

test("legacy global completion preserves past marks and does not complete future weeks", async () => {
  const a = app([daily({ repeat: "weekly", weekday: 5, startDate: undefined, completions: undefined, done: true })]);
  await a.context.loadData();
  let task = a.saved().tasks[0];
  assert.equal(task.completedThrough, "2026-10-02");
  assert.equal(a.context.taskDoneOnDate(task, "2026-10-02"), true);
  assert.equal(a.context.taskDoneOnDate(task, "2026-10-09"), false);
  const writes = a.writes();
  a.setDate(2026, 10, 9);
  await a.context.loadData();
  task = a.saved().tasks[0];
  assert.equal(task.completedThrough, "2026-10-02");
  assert.equal(a.writes(), writes);
  await a.context.toggleTask(11, 10, "2026-10-02");
  assert.equal(a.context.taskDoneOnDate(a.saved().tasks[0], "2026-10-02"), false);
});

test("celebrating a repeat archives that date and keeps the future series", async () => {
  const a = app([daily()]);
  await a.context.loadData();
  await a.context.celebrateTask(11, 10, "2026-10-03");
  const state = a.saved();
  const original = state.tasks.find(t => t.id === 11);
  const archived = state.tasks.find(t => t.recurringTaskId === 11);
  assert.equal(original.folderId, 10);
  assert.equal(original.repeat, "daily");
  assert.equal(a.context.taskDoneOnDate(original, "2026-10-04"), false);
  assert.equal(archived.date, "2026-10-03");
  assert.equal(archived.done, true);
  assert.equal(archived.repeat, undefined);
  assert.ok(state.folders.find(f => f.id === archived.folderId).celebration);
  await a.context.celebrateTask(11, 10, "2026-10-03");
  assert.equal(a.saved().tasks.length, 2);
});

test("existing archived tasks are not reactivated as routines", async () => {
  const a = app([daily({ done: true, celebratedAt: "2026-10-01T12:00:00Z" })]);
  await a.context.loadData();
  assert.equal(a.context.getTaskRepeat(a.saved().tasks[0]), "");
  assert.equal(a.saved().tasks[0].done, true);
  assert.equal(a.writes(), 0);
});

test("one-time tasks and overdue deadlines retain their existing completion behavior", async () => {
  const task = { id: 12, folderId: 10, text: "Одна справа", type: "ownDeadline", date: "2026-10-01", done: false, bookTracker: { bookId: "book", excerptId: "part", fields: ["plot"] } };
  const a = app([task]);
  await a.context.showToday();
  assert.ok(a.main.innerHTML.includes(task.text));
  await a.context.toggleTodayTask(12);
  await a.context.showToday();
  assert.equal(a.saved().tasks[0].done, true);
  assert.deepEqual(a.saved().tasks[0].bookTracker, task.bookTracker);
  assert.ok(!a.main.innerHTML.includes(task.text));
});

test("a new daily routine can be added directly from a calendar date", async () => {
  const a = app([], ["Мікроприбирання", "1", "1", "8:00"]);
  await a.context.addTaskForDate("2026-10-03", 6, "calendar");
  const task = a.saved().tasks[0];
  assert.equal(task.repeat, "daily");
  assert.equal(task.startDate, "2026-10-03");
  assert.equal(task.time, "08:00");
  assert.equal(on(a.context, task, "2026-10-02"), false);
  assert.equal(on(a.context, task, "2026-10-04"), true);
  assert.deepEqual(a.alerts, []);
});

test("own deadlines can repeat, while a non-repeating deadline keeps its date", async () => {
  const a = app([], ["Прибирання", "3", "2026-10-02", "", "1"]);
  await a.context.addTask(10);
  const task = a.saved().tasks[0];
  assert.equal(task.type, "ownDeadline");
  assert.equal(task.repeat, "daily");
  assert.equal(on(a.context, task, "2026-10-03"), true);
  const b = app([], ["Здати роботу", "2", "2026-10-10", "", "0"]);
  await b.context.addTask(10);
  assert.equal(b.saved().tasks[0].repeat, undefined);
  assert.equal(b.saved().tasks[0].date, "2026-10-10");
});

test("cancelling an edit leaves the original text and schedule intact", async () => {
  const original = daily();
  const a = app([original], ["Інший текст", "1", "1", null]);
  await a.context.editTask(11, 10);
  assert.deepEqual(a.saved().tasks[0], original);
  assert.deepEqual(a.state().tasks[0], original);
  assert.equal(a.writes(), 0);
});

test("a completed routine does not ring today but its next occurrence does", async () => {
  const a = app([daily({ chime: true, completions: { "2026-10-02": true } })]);
  let played = 0;
  a.context.playTaskChime = async () => { played++; return true; };
  await a.context.checkTimedTaskChimes();
  assert.equal(played, 0);
  a.setDate(2026, 10, 3, 8, 1);
  await a.context.checkTimedTaskChimes();
  assert.equal(played, 1);
  await a.context.checkTimedTaskChimes();
  assert.equal(played, 1);
  assert.equal(a.saved().tasks[0].chimedFor, "2026-10-03|08:00");
});

test("a weekly routine added from a folder accepts several selected days", async () => {
  const a = app([], ["Англійська", "1", "2", "1, 3, 5", "18:00"]);
  await a.context.addTask(10, "2026-10-02");
  const task = a.saved().tasks[0];
  assert.ok(task, "The weekly task must be saved after selecting multiple days");
  assert.equal(task.repeat, "weekly");
  assert.deepEqual(task.weekdays, [1, 3, 5]);
  assert.equal(task.time, "18:00");
  for (const date of ["2026-10-02", "2026-10-05", "2026-10-07", "2026-10-09"]) {
    assert.equal(on(a.context, task, date), true);
  }
  for (const date of ["2026-10-01", "2026-10-03", "2026-10-06", "2026-10-08"]) {
    assert.equal(on(a.context, task, date), false);
  }
  assert.deepEqual(a.alerts, []);
});

test("adding from the calendar saves all weekdays and completing one leaves the others visible", async () => {
  const a = app([], ["Прогулянка", "1", "2", "5; 6 7 5", "9:00"]);
  await a.context.addTaskForDate("2026-10-02", 5, "calendar");
  const task = a.saved().tasks[0];
  assert.ok(task, "The calendar must save the weekly task");
  assert.deepEqual(task.weekdays, [5, 6, 7]);
  await a.context.showWeek();
  assert.equal((a.main.innerHTML.match(/Прогулянка/g) || []).length, 3);
  await a.context.toggleWeekTask(task.id, "2026-10-03");
  await a.context.showWeek();
  assert.equal((a.main.innerHTML.match(/Прогулянка/g) || []).length, 2);
  assert.ok(a.main.innerHTML.includes("2026-10-04"));
  assert.equal(a.context.taskDoneOnDate(a.saved().tasks[0], "2026-10-04"), false);
  assert.equal(a.context.taskDoneOnDate(a.saved().tasks[0], "2026-10-10"), false);
  await a.context.showCalendar(2026, 9);
  assert.equal((a.main.innerHTML.match(/Прогулянка/g) || []).length, 14);
  assert.equal((a.main.innerHTML.match(/class="calendar-task calendar-task-done"/g) || []).length, 1);
  a.setDate(2026, 10, 4);
  await a.context.showToday();
  assert.ok(a.main.innerHTML.includes("Прогулянка"));
});

test("a repeating deadline can also select several weekdays", async () => {
  const a = app([], ["Заняття", "3", "2026-10-02", "", "2", "2,4"]);
  await a.context.addTask(10);
  const task = a.saved().tasks[0];
  assert.ok(task, "The repeating deadline must be saved");
  assert.equal(task.type, "ownDeadline");
  assert.deepEqual(task.weekdays, [2, 4]);
  assert.equal(on(a.context, task, "2026-10-06"), true);
  assert.equal(on(a.context, task, "2026-10-08"), true);
  assert.equal(on(a.context, task, "2026-10-07"), false);
});

test("editing a weekly routine keeps its selected days as the default", async () => {
  const original = daily({ repeat: "weekly", weekdays: [2, 4], weekday: 2 });
  const a = app([original], ["Англійська", "1", "2", "2,4,7", "18:00"]);
  await a.context.editTask(11, 10);
  const task = a.saved().tasks[0];
  assert.deepEqual(task.weekdays, [2, 4, 7]);
  assert.equal(a.prompts[3].value, "2,4");
  assert.equal(on(a.context, task, "2026-10-04"), true);
  assert.deepEqual(a.alerts, []);
});

test("an invalid weekday selection can be corrected without starting the task again", async () => {
  const a = app([], ["Прогулянка", "1", "2", "1,8", "2,4", "9:00"]);
  await a.context.addTask(10);
  assert.deepEqual(a.saved().tasks[0]?.weekdays, [2, 4]);
  assert.equal(a.alerts.length, 1);
  const b = app([], ["Прогулянка", "1", "2", "1,8", null]);
  await b.context.addTask(10);
  assert.equal(b.saved().tasks.length, 0);
  assert.equal(b.writes(), 0);
});

test("switching away from a weekly routine clears its selected weekdays", async () => {
  const original = daily({ repeat: "weekly", weekdays: [2, 4], weekday: 2 });
  const a = app([original], ["Прогулянка", "1", "1", "9:00"]);
  await a.context.editTask(11, 10);
  assert.equal(a.saved().tasks[0].repeat, "daily");
  assert.equal(a.saved().tasks[0].weekdays, undefined);
  assert.equal(a.saved().tasks[0].weekday, undefined);
  assert.equal(on(a.context, a.saved().tasks[0], "2026-10-04"), true);
  const b = app([original], ["Прогулянка", "4", "2026-10-04", ""]);
  await b.context.editTask(11, 10);
  assert.equal(b.saved().tasks[0].repeat, undefined);
  assert.equal(b.saved().tasks[0].weekdays, undefined);
});
