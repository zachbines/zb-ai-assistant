/**
 * T/Z Task Manager — daily reminder emails (Google Apps Script version).
 *
 * Runs entirely on Google's servers on a daily timer — independent of any
 * laptop. Reads a Google Doc laid out as weekday headings + tagged bullets,
 * and emails Zach & Taylor their tasks each morning. No AI, pure parsing.
 * Sends straight from your Gmail (no app password needed).
 *
 * ONE-TIME SETUP:
 *   1. Go to https://script.google.com  →  New project.
 *   2. Delete the sample code, paste this whole file in.
 *   3. Sign in as the account you want emails to come FROM (zachbines@gmail.com).
 *   4. Run the `setup` function once (Run ▸ setup). Approve the permission prompt.
 *      This creates the "T/Z Task Manager" Google Doc (with the template) and
 *      installs the 7 AM daily trigger. The Doc's link is printed in the log.
 *   5. Done. Edit the Doc each week; emails go out at 7 AM daily.
 *
 * To preview without waiting for 7 AM: run `previewToday` (writes to the log,
 * sends nothing) or `sendNow` (actually sends today's emails right now).
 */

// --------------------------------------------------------------------------- //
// CONFIG — edit these
// --------------------------------------------------------------------------- //
const CONFIG = {
  docName: 'T/Z Task Manager',
  fromName: 'T/Z Task Manager',        // display name recipients see
  sendHour: 7,                          // 24h local time; trigger fires 7–8 AM
  people: {
    zach:   { name: 'Zach',   email: 'zachbines+tzmanager@gmail.com' },
    taylor: { name: 'Taylor', email: 'tnellesmcgee+tzmanager@gmail.com' },
  },
  // While testing, Taylor's email is redirected here and subjects get [TEST].
  // Set testMode to false to email Taylor for real.
  testMode: true,
  testRedirect: { taylor: 'zachbines+fortayloractually@gmail.com' },

  // Phase 1: mirror the day's tasks into Todoist.
  // The API token is read from Script Properties (key TODOIST_TOKEN), NOT here.
  //   Project Settings ⚙ → Script Properties → add TODOIST_TOKEN = <your token>
  //   (Todoist → Settings → Integrations → Developer → API token)
  todoist: {
    pushFor: ['zach'],       // whose tasks become Todoist tasks (add 'taylor' later)
    projectId: '',           // '' = Inbox; else a Todoist project id string
    defaultTime: '9am',      // due time used when an item's text has no time
  },

  // Staleness guard: don't keep re-sending a week-old list if you forget to
  // refresh the Doc. Uses the date at the TOP of the Doc (a date smart chip or
  // typed date); if none is found, falls back to the Doc's last-edited time.
  // The scheduled 7 AM run is blocked once the list is older than maxDays;
  // manual sends from the T/Z Tasks menu always go through.
  freshness: { maxDays: 7 },
};

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAILY_HEADINGS = ['daily', 'everyday', 'every day'];
const TAG_MAP = { zach: 'zach', z: 'zach', taylor: 'taylor', t: 'taylor', both: 'both', us: 'both' };
const TAG_RE = /@(zach|taylor|both|z|t|us)\b/gi;

// --------------------------------------------------------------------------- //
// SETUP — run once
// --------------------------------------------------------------------------- //
function setup() {
  const doc = getDoc_();
  PropertiesService.getScriptProperties().setProperty('docId', doc.getId());
  ensureTemplate_(doc);
  installTrigger_();
  Logger.log('Setup complete.');
  Logger.log('Task Doc: ' + doc.getUrl());
  Logger.log('Daily trigger installed for ~' + CONFIG.sendHour + ':00 (script timezone: ' +
             Session.getScriptTimeZone() + ').');
}

// Adds the "T/Z Tasks" menu when the Doc is opened (bound-script only).
function onOpen() {
  const ui = DocumentApp.getUi();
  ui.createMenu('T/Z Tasks')
    .addItem("Send today's tasks now", 'menuSendNow')
    .addItem('Preview today (no send)', 'menuPreview')
    .addItem('Push today to Todoist', 'menuPushTodoist')
    .addToUi();
}

function menuSendNow() {
  run_(false, true);   // manual — bypass the staleness guard
  uiAlert_("Sent today's tasks ✓");
}

function menuPreview() {
  uiAlert_("Preview — today's emails", buildPreviewText_());
}

// Shows a Doc alert when there's a UI (menu click); falls back to the log when
// run from the script editor / a trigger (where getUi() isn't available).
function uiAlert_(title, msg) {
  try {
    const ui = DocumentApp.getUi();
    if (msg == null) ui.alert(title);
    else ui.alert(title, msg, ui.ButtonSet.OK);
  } catch (e) {
    Logger.log(title + (msg == null ? '' : '\n' + msg));
  }
}

function menuPushTodoist() {
  const doc = getDoc_();
  const days = parseDoc_(doc);
  const weekday = WEEKDAYS[(new Date().getDay() + 6) % 7];
  const label = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  CONFIG.todoist.pushFor.forEach(function (person) {
    // Force: clear today's guard so a manual push always runs.
    PropertiesService.getScriptProperties().deleteProperty(todoistGuardKey_(person));
    pushPersonToTodoist_(person, days[weekday], label);
  });
  uiAlert_("Pushed today's tasks to Todoist ✓ (see Executions log for details)");
}

function installTrigger_() {
  // Remove any existing triggers for this function to avoid duplicates.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyReminders')
    .timeBased().atHour(CONFIG.sendHour).everyDays(1).create();
}

// Returns the task Doc. In a Doc-bound script this is the container document;
// standalone, it falls back to the stored/named Doc (creating one if needed).
function getDoc_() {
  try {
    const active = DocumentApp.getActiveDocument();
    if (active) return active;
  } catch (e) { /* not a bound script — fall through */ }
  return getOrCreateDoc_();
}

// True if the list is current enough to send. Prefers the date at the top of
// the Doc (smart chip or typed); falls back to the Doc's last-edited time.
function isDocFresh_(doc) {
  const maxDays = CONFIG.freshness.maxDays;
  const today = startOfDay_(new Date());

  const docDate = parseDocDate_(doc.getBody().getText());

  // Fail closed: no readable date at the top → do NOT send. This matches the
  // "update every week" contract — a stale or missing date pauses the emails.
  // NOTE: the date must be TYPED TEXT (e.g. "Aug 6, 2026"). Google Docs date
  // smart chips are not readable via getText(), so a chip reads as "no date"
  // and (correctly) blocks the send. Do not fall back to the Doc's last-edited
  // time — any edit (even setting an old date to pause) refreshes it, which
  // would defeat the guard.
  if (!docDate) {
    Logger.log('No readable date at top of Doc — skipping send. Type the date as ' +
               'text like "' + Utilities.formatDate(today, Session.getScriptTimeZone(), 'MMM d, yyyy') +
               '" (date smart chips are NOT readable by the script).');
    return false;
  }

  const age = daysBetween_(docDate, today);
  if (age < 0 || age >= maxDays) {
    Logger.log('List date ' + docDate.toDateString() + ' is ' + age +
               ' day(s) from today (max ' + maxDays + ') — skipping stale send.');
    return false;
  }
  return true;
}

// Scans the first few lines for a date and returns it as a local Date, or null.
// Handles "Jul 31, 2026" (date smart chip), "2026-07-31", and "7/31/2026".
function parseDocDate_(text) {
  const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
                   jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const head = splitLines_(text).slice(0, 6).join('\n');

  let m = head.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && months[m[1].slice(0, 3).toLowerCase()] !== undefined) {
    return new Date(+m[3], months[m[1].slice(0, 3).toLowerCase()], +m[2]);
  }
  m = head.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = head.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
  return null;
}

function startOfDay_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function daysBetween_(from, to) { return Math.round((to - from) / 86400000); }

// Writes the starter template only if the Doc has no weekday headings yet,
// so it never clobbers a Doc you've already filled in.
function ensureTemplate_(doc) {
  const text = doc.getBody().getText().toLowerCase();
  const hasDays = WEEKDAYS.some(function (d) { return text.indexOf(d) !== -1; });
  if (!hasDays) writeTemplate_(doc);
}

function getOrCreateDoc_() {
  const props = PropertiesService.getScriptProperties();

  // 1. Reuse the Doc we created before, if it's still openable.
  const id = props.getProperty('docId');
  if (id) {
    const doc = tryOpenDoc_(id);
    if (doc) return doc;
    props.deleteProperty('docId'); // stale/deleted — forget it
  }

  // 2. Reuse an existing same-named Doc, but only one we can actually open
  //    and that isn't in the trash. Skip anything that errors.
  try {
    const files = DriveApp.getFilesByName(CONFIG.docName);
    while (files.hasNext()) {
      const file = files.next();
      if (file.isTrashed()) continue;
      const doc = tryOpenDoc_(file.getId());
      if (doc) { props.setProperty('docId', doc.getId()); return doc; }
    }
  } catch (e) { /* fall through to create */ }

  // 3. Nothing usable — create a fresh Doc with the template.
  const doc = DocumentApp.create(CONFIG.docName);
  writeTemplate_(doc);
  props.setProperty('docId', doc.getId());
  return doc;
}

function tryOpenDoc_(id) {
  try { return DocumentApp.openById(id); } catch (e) { return null; }
}

function writeTemplate_(doc) {
  const body = doc.getBody();
  const H2 = DocumentApp.ParagraphHeading.HEADING2;
  const H3 = DocumentApp.ParagraphHeading.HEADING3;
  const BULLET = DocumentApp.GlyphType.BULLET;
  body.clear();

  // A date at the very top drives the staleness guard. Replace this typed date
  // with a Google Docs date smart chip if you prefer — both are read the same.
  body.appendParagraph(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d, yyyy'));

  body.appendParagraph(CONFIG.docName).setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(
    'Under each day: loose bullets = standing shared tasks (shown first, to both). ' +
    '"Todos" = tagged tasks — @zach/@z, @taylor/@t, @both. "Dinner" = tonight\'s dinner. ' +
    'Untagged todos get flagged. A "Daily" item repeats every day. Emails go out at ' +
    CONFIG.sendHour + ' AM.');

  // Builds one day: heading, standing bullets, Todos subheading + items, Dinner.
  function day(name, standing, todos, dinner, withDinner) {
    body.appendParagraph(name).setHeading(H2);
    standing.forEach(function (s) { body.appendListItem(s).setGlyphType(BULLET); });
    body.appendParagraph('Todos').setHeading(H3);
    todos.forEach(function (t) { body.appendListItem(t).setGlyphType(BULLET); });
    if (withDinner) {
      body.appendParagraph('Dinner').setHeading(H3);
      if (dinner) body.appendParagraph(dinner);
    }
  }

  day('Daily', [], ['@zach '], '', false);
  day('Monday',
      ['Example: grocery day', 'Example: laundry day'],
      ['Example: call plumber @both', 'Example: daycare drop-off @taylor'],
      'Example: Chicken Kiev', true);
  ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].forEach(function (d) {
    day(d, [], ['@zach '], '', true);
  });
}

// --------------------------------------------------------------------------- //
// DAILY ENTRY POINT (called by the trigger)
// --------------------------------------------------------------------------- //
function sendDailyReminders() { run_(false, false); }  // scheduled — obeys freshness
function sendNow()            { run_(false, true);  }  // manual — always sends
function previewToday()       { run_(true,  false); }  // log only, send nothing

function run_(preview, force) {
  const doc = getDoc_();

  // Staleness guard (scheduled runs only): skip if the list looks stale.
  if (!preview && !force && !isDocFresh_(doc)) return;

  const docUrl = doc.getUrl();
  const days = parseDoc_(doc);
  const weekday = WEEKDAYS[(new Date().getDay() + 6) % 7]; // JS Sun=0 -> our Mon=0
  const day = days[weekday];
  const label = weekday.charAt(0).toUpperCase() + weekday.slice(1);

  [['zach', 'taylor'], ['taylor', 'zach']].forEach(function (pair) {
    const person = pair[0], partner = pair[1];
    const c = compose_(person, partner, day);
    const name = CONFIG.people[person].name;

    // Nothing to say to this person today (no standing/dinner/todos) → don't send.
    if (!hasContent_(c)) {
      Logger.log('Nothing for ' + name + ' on ' + label + ' — skipping.');
      return;
    }

    const subject = (CONFIG.testMode ? '[TEST] ' : '') + 'Your ' + label + ' tasks';
    const plain = renderPlain_(name, label, c, docUrl);
    const html = renderHtml_(name, label, c, docUrl);
    const to = recipientFor_(person);

    if (preview) {
      Logger.log('TO: ' + to + '  SUBJECT: ' + subject + '\n' + plain + '\n----------');
    } else {
      GmailApp.sendEmail(to, subject, plain, { htmlBody: html, name: CONFIG.fromName });
      Logger.log('Sent ' + label + ' reminder to ' + name + ' <' + to + '>');
      // Phase 1: mirror this person's todos into their Todoist.
      if (CONFIG.todoist.pushFor.indexOf(person) !== -1) {
        pushPersonToTodoist_(person, day, label);
      }
    }
  });
}

function recipientFor_(person) {
  if (CONFIG.testMode && CONFIG.testRedirect[person]) return CONFIG.testRedirect[person];
  return CONFIG.people[person].email;
}

// Builds a plain-text preview of today's two emails for the menu dialog.
function buildPreviewText_() {
  const doc = getDoc_();
  const docUrl = doc.getUrl();
  const days = parseDoc_(doc);
  const weekday = WEEKDAYS[(new Date().getDay() + 6) % 7];
  const label = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return [['zach', 'taylor'], ['taylor', 'zach']].map(function (pair) {
    const c = compose_(pair[0], pair[1], days[weekday]);
    const name = CONFIG.people[pair[0]].name;
    if (!hasContent_(c)) {
      return 'TO: ' + recipientFor_(pair[0]) + '  →  (no email — nothing for ' + name + ' today)';
    }
    return 'TO: ' + recipientFor_(pair[0]) + '\n' +
           renderPlain_(name, label, c, docUrl);
  }).join('\n\n──────────\n\n');
}

// --------------------------------------------------------------------------- //
// TODOIST (Phase 1) — create today's tasks in the person's Todoist
// --------------------------------------------------------------------------- //
function todoistToken_() {
  return PropertiesService.getScriptProperties().getProperty('TODOIST_TOKEN');
}

function todoistGuardKey_(person) {
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return 'tdPushed:' + person + ':' + today;
}

// Creates this person's own + shared TODOS as Todoist tasks (once per day).
// Standing weekly tasks and dinner are not pushed.
function pushPersonToTodoist_(person, day, label) {
  const token = todoistToken_();
  if (!token) { Logger.log('No TODOIST_TOKEN set — skipping Todoist for ' + person + '.'); return; }

  const props = PropertiesService.getScriptProperties();
  const guard = todoistGuardKey_(person);
  if (props.getProperty(guard)) { Logger.log('Todoist already pushed for ' + person + ' today — skipping.'); return; }

  const items = day.todos[person].concat(day.todos['both']);
  if (!items.length) { Logger.log('No Todoist items for ' + person + ' on ' + label + '.'); return; }

  let ok = 0;
  items.forEach(function (text) { if (createTodoistTask_(token, text)) ok++; });
  props.setProperty(guard, '1'); // mark done so the 7 AM run + a manual send don't double-create
  Logger.log('Todoist: created ' + ok + '/' + items.length + ' tasks for ' + person + '.');
}

function createTodoistTask_(token, text) {
  const parsed = extractTime_(text);
  const content = parsed ? parsed.content : text;
  const time = parsed ? parsed.time : CONFIG.todoist.defaultTime;
  const payload = { content: content, due_string: 'today at ' + time };
  if (CONFIG.todoist.projectId) payload.project_id = CONFIG.todoist.projectId;

  const res = UrlFetchApp.fetch('https://api.todoist.com/api/v1/tasks', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code >= 300) { Logger.log('Todoist create failed (' + code + '): ' + res.getContentText()); return false; }
  return true;
}

// Pulls a time out of an item's text ("Dentist 3pm", "Standup at 9:30 am",
// "Call 14:00") and returns { time, content } with the time (and any leading
// "at") removed from the content. Returns null when no time is found.
function extractTime_(text) {
  let m = text.match(/\b(?:at\s+)?(\d{1,2})(:\d{2})?\s*([ap]m)\b/i);
  let time = null;
  if (m) {
    time = (m[1] + (m[2] || '') + m[3]).toLowerCase().replace(/\s+/g, '');
  } else {
    m = text.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (m) time = m[1] + ':' + m[2];
  }
  if (!m) return null;

  const content = text.replace(m[0], ' ')
    .replace(/\s{2,}/g, ' ')            // collapse doubled spaces
    .replace(/\s+([,.;:])/g, '$1')      // no space before punctuation
    .replace(/^[\s\-–—:]+|[\s\-–—:@]+$/g, '')  // trim stray separators
    .trim();
  return { time: time, content: content || text };
}

// --------------------------------------------------------------------------- //
// PARSING (mirrors the Python version)
// --------------------------------------------------------------------------- //
function splitLines_(text) {
  return text.split(/\r?\n/).map(function (l) { return l.replace(/ /g, ' ').trim(); })
             .filter(function (l) { return l.length > 0; });
}

function cleanHeading_(line) {
  return line.replace(/^[-•*▪◦\s]+/, '').replace(/:\s*$/, '').trim().toLowerCase();
}
function stripBullet_(line) { return line.replace(/^[-•*▪◦\s]+/, '').trim(); }

function emptyDay_() {
  return { standing: [], dinner: [], todos: { zach: [], taylor: [], both: [], untagged: [] } };
}

// Element-based parse of the Doc. Uses the real structure:
//   ## Weekday / ## Daily  → a day. Loose items under it (before any ### sub-
//                            heading) are STANDING weekly tasks (shared).
//   ### Todos              → per-person tagged todos
//   ### Dinner             → dinner ("Dinner tonight")
function parseDoc_(doc) {
  const days = {};
  WEEKDAYS.forEach(function (d) { days[d] = emptyDay_(); });
  const daily = emptyDay_();

  let day = null;             // current day object (or daily) or null
  let section = 'standing';   // 'standing' | 'todos' | 'dinner'

  const body = doc.getBody();
  const n = body.getNumChildren();
  for (let i = 0; i < n; i++) {
    const el = body.getChild(i);
    const type = el.getType();

    if (type === DocumentApp.ElementType.LIST_ITEM) {
      if (day) addDocItem_(day, section, el.asListItem().getText());
      continue;
    }
    if (type !== DocumentApp.ElementType.PARAGRAPH) continue;

    const text = el.asParagraph().getText().trim();
    if (!text) continue;
    const norm = text.replace(/[*_#]/g, '').replace(/[:：]\s*$/, '').trim().toLowerCase();

    if (WEEKDAYS.indexOf(norm) !== -1)            { day = days[norm]; section = 'standing'; }
    else if (DAILY_HEADINGS.indexOf(norm) !== -1) { day = daily;      section = 'standing'; }
    else if (norm === 'todos' || norm === 'todo') { section = 'todos'; }
    else if (norm === 'dinner')                   { section = 'dinner'; }
    else if (day)                                 { addDocItem_(day, section, text); } // stray text (e.g. dinner name)
    // else: title / legend before the first day — ignore
  }

  // Fold Daily into every weekday.
  WEEKDAYS.forEach(function (d) {
    days[d].standing = daily.standing.concat(days[d].standing);
    days[d].dinner = daily.dinner.concat(days[d].dinner);
    ['zach', 'taylor', 'both', 'untagged'].forEach(function (o) {
      days[d].todos[o] = daily.todos[o].concat(days[d].todos[o]);
    });
  });
  return days;
}

// Routes one item into the current section's bucket. Standing items are shared
// (tags ignored); todos keep their @tag owner; dinner keeps its raw text.
function addDocItem_(day, section, raw) {
  if (section === 'dinner') {
    const t = raw.trim();
    if (t) day.dinner.push(t);
    return;
  }
  const parsed = extractTask_(raw);   // strips tags, resolves owner
  if (!parsed.task) return;           // empty / placeholder like "@zach "
  if (section === 'standing') day.standing.push(parsed.task);
  else day.todos[parsed.owner].push(parsed.task);
}

function hasContent_(c) {
  return c.standing.length || c.dinner.length || c.mine.length || c.untagged.length;
}

function extractTask_(text) {
  const owners = {};
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text)) !== null) owners[TAG_MAP[m[1].toLowerCase()]] = true;
  let task = text.replace(TAG_RE, '').replace(/\s{2,}/g, ' ').replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '');
  let owner;
  if (Object.keys(owners).length === 0) owner = 'untagged';
  else if (owners['both'] || (owners['zach'] && owners['taylor'])) owner = 'both';
  else owner = Object.keys(owners)[0];
  return { task: task, owner: owner };
}

// --------------------------------------------------------------------------- //
// COMPOSE / RENDER
// --------------------------------------------------------------------------- //
function compose_(person, partner, day) {
  const todos = day.todos;
  const mine = todos[person].concat(todos['both'].map(function (t) { return t + ' (shared)'; }));
  return {
    standing: day.standing.slice(),
    dinner: day.dinner.slice(),
    mine: mine,
    untagged: todos['untagged'].slice(),
  };
}

// Email body order: Standing weekly tasks → Dinner tonight → <Name>'s todos
// (+ untagged). Each person only sees their own todos plus the shared items.
function renderPlain_(name, label, c, docUrl) {
  const out = ['Good morning ' + name + "! Here's your " + label + '.', ''];

  if (c.standing.length) {
    out.push('STANDING WEEKLY TASKS');
    c.standing.forEach(function (t) { out.push('  • ' + t); });
    out.push('');
  }
  if (c.dinner.length) {
    out.push('DINNER TONIGHT');
    c.dinner.forEach(function (t) { out.push('  • ' + t); });
    out.push('');
  }

  out.push(name.toUpperCase() + "'S TODOS");
  if (c.mine.length) c.mine.forEach(function (t) { out.push('  • ' + t); });
  else out.push('  • Nothing personal today.');
  out.push('');

  if (c.untagged.length) {
    out.push('UNTAGGED (nobody assigned — tag with @zach/@taylor/@both)');
    c.untagged.forEach(function (t) { out.push('  • ' + t); });
    out.push('');
  }
  if (docUrl) { out.push('Edit the list: ' + docUrl); out.push(''); }
  out.push('— T/Z Task Manager');
  return out.join('\n');
}

function renderHtml_(name, label, c, docUrl) {
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function ul(items) { return '<ul>' + items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>'; }
  function h3(t, color) { return "<h3 style='margin-bottom:4px" + (color ? ';color:' + color : '') + "'>" + esc(t) + '</h3>'; }

  const p = ["<div style='font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;color:#222'>",
    '<p>Good morning <b>' + esc(name) + "</b>! Here's your " + esc(label) + '.</p>'];

  if (c.standing.length) { p.push(h3('Standing weekly tasks')); p.push(ul(c.standing)); }
  if (c.dinner.length)   { p.push(h3('Dinner tonight')); p.push(ul(c.dinner)); }

  p.push(h3(name + "'s to-dos"));
  p.push(c.mine.length ? ul(c.mine) : '<p>Nothing personal today.</p>');

  if (c.untagged.length) {
    p.push(h3('Untagged', '#a15c00'));
    p.push("<p style='color:#a15c00;margin:0 0 4px'>Nobody assigned — tag with @zach/@taylor/@both.</p>");
    p.push(ul(c.untagged));
  }
  if (docUrl) {
    p.push("<p style='margin-top:12px'><a href='" + docUrl + "' " +
           "style='color:#2b6cb0;text-decoration:none'>✎ Edit the task list</a></p>");
  }
  p.push("<p style='color:#888;font-size:13px'>— T/Z Task Manager</p></div>");
  return p.join('');
}
