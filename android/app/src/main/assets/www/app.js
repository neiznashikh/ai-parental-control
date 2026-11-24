// Learn2Unlock AI — интерфейс ребёнка и родителя
(function () {
  var NA = window.Android || null; // мост к Android (null в браузере)
  var TYPES = ["math", "logic", "read_aloud", "retell", "typing", "writing", "language"];
  var LANGS = ["ru", "kk", "en"];
  var SPEECH_CODES = { ru: "ru-RU", kk: "kk-KZ", en: "en-US" };
  var MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"];

  // ---------- состояние ----------
  function defaults() {
    var stats = {};
    TYPES.forEach(function (t) { stats[t] = { level: 4, streak: 0, total: 0, passed: 0, mistakes: [] }; });
    var types = {};
    TYPES.forEach(function (t) { types[t] = true; });
    return {
      setupDone: false, uiLang: "ru", pin: "", apiKey: "", model: "claude-sonnet-5-5",
      profile: { name: "", age: 10, grade: 4, interests: "" },
      taskLangs: ["ru"], learnLangs: ["en"], types: types,
      minutes: 20, tasksPer: 3, dailyLimit: 120,
      stats: stats, history: [], recent: [], earned: { date: "", minutes: 0 }
    };
  }

  var state = defaults();
  try {
    var raw = NA ? NA.load("state") : localStorage.getItem("state");
    if (raw) {
      var saved = JSON.parse(raw);
      var d = defaults();
      for (var k in saved) d[k] = saved[k];
      TYPES.forEach(function (t) {
        if (!d.stats[t]) d.stats[t] = defaults().stats[t];
        if (d.types[t] === undefined) d.types[t] = true;
      });
      state = d;
    }
  } catch (e) { }

  function save() {
    var s = JSON.stringify(state);
    if (NA) NA.save("state", s); else localStorage.setItem("state", s);
  }

  window.App = { settings: function () { return state; } };

  // ---------- утилиты ----------
  function t(key, vars) {
    var s = (I18N[state.uiLang] && I18N[state.uiLang][key]) || I18N.ru[key] || key;
    if (vars) for (var v in vars) s = s.split("{" + v + "}").join(vars[v]);
    return s;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function $(id) { return document.getElementById(id); }
  function today() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function earnedToday() { return state.earned.date === today() ? state.earned.minutes : 0; }
  function unlockUntil() { return NA ? parseInt(NA.getUnlockUntil(), 10) || 0 : 0; }
  function isLock() { return NA ? NA.isLockMode() : false; }
  function targetName() {
    var p = NA ? NA.getTarget() : "";
    return p ? NA.getAppLabel(p) : "";
  }
  function toast(m) { if (NA) NA.toast(m); else console.log(m); }
  function fmtTime(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60), r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }
  function clock(ts) { var d = new Date(ts); return d.getHours() + ":" + ("0" + d.getMinutes()).slice(-2); }
  function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function errText(e) {
    var m = (e && e.message) || String(e);
    if (m === "NO_KEY") return t("noApiKey");
    return t("aiError") + " (" + m + ")";
  }

  var screen = "home", timer = null;
  var app = document.getElementById("app");
  function setHTML(html) {
    if (timer) { clearInterval(timer); timer = null; }
    Speech.stop(true);
    app.innerHTML = html;
    window.scrollTo(0, 0);
  }

  // обработка нажатий через data-act
  var acts = {};
  app.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    var fn = acts[el.getAttribute("data-act")];
    if (fn) fn(el.getAttribute("data-arg"), el);
  });

  // ---------- распознавание речи ----------
  var Speech = {
    on: false, finals: "", h: null,
    start: function (lang, handlers) {
      Speech.h = handlers; Speech.finals = "";
      if (!NA || !NA.speechAvailable()) { handlers.error(t("speechUnavailable")); return; }
      if (!NA.hasMic()) {
        window.onMicPermission = function (ok) {
          if (ok) Speech.start(lang, handlers); else handlers.error(t("micDenied"));
        };
        NA.requestMic();
        return;
      }
      Speech.on = true;
      NA.startListening(SPEECH_CODES[lang] || "ru-RU");
      handlers.state(true);
    },
    stop: function (silent) {
      if (!Speech.on) return;
      Speech.on = false;
      if (NA) NA.stopListening();
      if (silent) Speech.h = null;
      else if (Speech.h) Speech.h.state(false);
    }
  };
  window.__speech = function (ev, text) {
    var h = Speech.h;
    if (!h) return;
    if (ev === "partial") h.text((Speech.finals + " " + text).trim());
    else if (ev === "final") { Speech.finals = (Speech.finals + " " + text).trim(); h.text(Speech.finals); }
    else if (ev === "error") {
      Speech.on = false; h.state(false);
      h.error(text === "language" ? t("speechLangUnavailable") : text === "permission" ? t("micDenied") : t("speechUnavailable"));
    } else if (ev === "end") { if (!Speech.on) h.state(false); }
  };

  // ---------- навигация ----------
  function render() {
    if (!state.setupDone) return renderSetup();
    if (screen === "session") return renderSessionScreen();
    if (screen === "pin") return renderPin();
    if (screen === "parent") return renderParent();
    return renderHome();
  }

  window.onBack = function () {
    if (screen === "parent" || screen === "pin") { exitParent(); return; }
    if (screen === "session" && session && session.finished) { screen = "home"; render(); return; }
    if (screen === "session") { screen = "home"; session = null; render(); return; }
    if (!state.setupDone && setupStep > 0) { setupStep--; render(); return; }
    if (NA) NA.goHome();
  };
  window.onAppIntent = function () {
    if (screen === "session" && session && !session.finished) { session.target = targetName(); return; }
    if (screen !== "parent" && screen !== "pin" && state.setupDone) { screen = "home"; render(); }
  };
  window.onAppResume = function () {
    if (!state.setupDone && setupStep === 5) render();
    else if (screen === "parent" && (parentTab === "protect")) render();
    else if (screen === "home") render();
  };

  // ---------- первая настройка ----------
  var setupStep = 0, tmpPin = "";

  function chips(name, list, selected, labelFn) {
    return '<div class="chips">' + list.map(function (v) {
      var on = selected.indexOf(v) >= 0;
      return '<button class="chip' + (on ? " on" : "") + '" data-act="chip" data-arg="' + name + ":" + v + '">' + esc(labelFn(v)) + "</button>";
    }).join("") + "</div>";
  }
  acts.chip = function (arg) {
    var p = arg.split(":"), name = p[0], v = p[1];
    if (name === "uiLang") { state.uiLang = v; save(); render(); return; }
    if (name === "types") { state.types[v] = !state.types[v]; save(); render(); return; }
    var arr = state[name], i = arr.indexOf(v);
    if (i >= 0) { if (arr.length > 1 || name === "learnLangs") arr.splice(i, 1); } else arr.push(v);
    save(); render();
  };
  function langLabel(l) { return t("lang_" + l); }

  function permBlock() {
    var acc = NA ? NA.isAccessibilityOn() : false;
    var mic = NA ? NA.hasMic() : false;
    return '<h3>' + t("permAccess") + '</h3>' +
      (acc ? '<div class="okbox">' + t("permOn") + '</div>' :
        '<div class="warn">' + t("permOff") + '. ' + t("permAccessText") + '</div>' +
        '<div class="stack" style="margin-top:10px"><button class="btn2" data-act="openAcc">' + t("openSettings") + '</button>' +
        '<div class="muted">' + t("permRestricted") + '</div>' +
        '<button class="btn2" data-act="openInfo">' + t("openAppInfo") + '</button></div>') +
      '<h3>' + t("mic") + '</h3>' +
      (mic ? '<div class="okbox">' + t("micOn") + '</div>' : '<button class="btn2" data-act="mic">' + t("micGrant") + '</button>');
  }
  acts.openAcc = function () { if (NA) { NA.setParentMinutes(15); NA.openAccessibilitySettings(); } };
  acts.openInfo = function () { if (NA) { NA.setParentMinutes(15); NA.openAppInfo(); } };
  acts.mic = function () { if (NA) { window.onMicPermission = function () { render(); }; NA.requestMic(); } };

  function renderSetup() {
    screen = "setup";
    if (NA) NA.setParentMinutes(30);
    var body = "", n = 7;
    if (setupStep === 0) {
      body = '<h2>' + t("welcome") + '</h2><p>' + t("welcomeText") + '</p>' +
        '<label class="f">' + t("chooseLang") + '</label>' + chips("uiLang", LANGS, [state.uiLang], langLabel) +
        '<div style="margin-top:16px"><button class="btn" data-act="setupNext">' + t("next") + '</button></div>';
    } else if (setupStep === 1) {
      body = '<h2>' + t("setPin") + '</h2><p class="muted">' + t("pinHint") + '</p>' +
        '<input id="pin1" type="password" inputmode="numeric" maxlength="6" class="pin">' +
        '<label class="f">' + t("pinRepeat") + '</label><input id="pin2" type="password" inputmode="numeric" maxlength="6" class="pin">' +
        '<div style="margin-top:16px"><button class="btn" data-act="setupPin">' + t("next") + '</button></div>';
    } else if (setupStep === 2) {
      body = '<h2>' + t("childProfile") + '</h2>' + profileForm() +
        '<div style="margin-top:16px"><button class="btn" data-act="setupProfile">' + t("next") + '</button></div>';
    } else if (setupStep === 3) {
      body = '<h2>' + t("taskTypes") + '</h2>' + tasksForm(false) +
        '<div style="margin-top:16px"><button class="btn" data-act="setupTasks">' + t("next") + '</button></div>';
    } else if (setupStep === 4) {
      body = '<h2>' + t("apiKey") + '</h2>' + aiForm() +
        '<div style="margin-top:16px"><button class="btn" data-act="setupKey">' + t("next") + '</button></div>';
    } else if (setupStep === 5) {
      body = '<h2>' + t("permissions") + '</h2>' + permBlock() +
        '<div style="margin-top:16px"><button class="btn" data-act="setupNext">' + t("next") + '</button></div>';
    } else {
      body = '<h2>' + t("chooseApps") + '</h2><p class="muted">' + t("chooseAppsHint") + '</p>' + appsList() +
        '<div style="margin-top:16px"><button class="btn" data-act="setupFinish">' + t("finish") + '</button></div>';
    }
    setHTML('<div class="top"><h1>Learn2Unlock AI</h1><div class="sub">' + (setupStep + 1) + " / " + n + '</div>' +
      '<div class="progress"><div style="width:' + Math.round((setupStep + 1) * 100 / n) + '%"></div></div></div>' +
      '<div class="wrap"><div class="card">' + body + '</div></div>');
  }
  acts.setupNext = function () { setupStep++; render(); };
  acts.setupPin = function () {
    var a = $("pin1").value.trim(), b = $("pin2").value.trim();
    if (!/^\d{4,6}$/.test(a)) return toast(t("pinShort"));
    if (a !== b) return toast(t("pinMismatch"));
    state.pin = a; save(); setupStep++; render();
  };
  acts.setupProfile = function () { readProfile(); setupStep++; render(); };
  acts.setupTasks = function () { readTasks(); setupStep++; render(); };
  acts.setupKey = function () { readAI(); setupStep++; render(); };
  acts.setupFinish = function () {
    state.setupDone = true; save();
    if (NA) NA.setParentMinutes(0);
    screen = "home"; render();
  };

  // ---------- общие формы ----------
  function profileForm() {
    var p = state.profile;
    return '<label class="f">' + t("childName") + '</label><input id="pName" type="text" value="' + esc(p.name) + '">' +
      '<div class="grid2"><div><label class="f">' + t("age") + '</label><input id="pAge" type="number" min="5" max="15" value="' + esc(p.age) + '"></div>' +
      '<div><label class="f">' + t("grade") + '</label><input id="pGrade" type="number" min="0" max="11" value="' + esc(p.grade) + '"></div></div>' +
      '<label class="f">' + t("interests") + '</label><input id="pInt" type="text" placeholder="' + esc(t("interestsHint")) + '" value="' + esc(p.interests) + '">';
  }
  function readProfile() {
    var p = state.profile;
    p.name = $("pName").value.trim();
    p.age = Math.min(15, Math.max(5, parseInt($("pAge").value, 10) || 10));
    p.grade = Math.min(11, Math.max(0, parseInt($("pGrade").value, 10) || 4));
    p.interests = $("pInt").value.trim();
    save();
  }
  function tasksForm(withLevels) {
    var on = TYPES.filter(function (x) { return state.types[x]; });
    var html = chips("types", TYPES, on, function (x) { return t("type_" + x); }) +
      '<label class="f">' + t("taskLangs") + '</label>' + chips("taskLangs", LANGS, state.taskLangs, langLabel) +
      '<label class="f">' + t("learnLangs") + '</label>' + chips("learnLangs", LANGS, state.learnLangs, langLabel) +
      '<div class="grid2"><div><label class="f">' + t("tasksPerUnlock") + '</label><input id="tPer" type="number" min="1" max="10" value="' + state.tasksPer + '"></div>' +
      '<div><label class="f">' + t("minutesPerUnlock") + '</label><input id="tMin" type="number" min="1" max="240" value="' + state.minutes + '"></div></div>';
    if (withLevels) {
      html += '<h3>' + t("level") + '</h3>' + TYPES.map(function (x) {
        return '<div class="stat"><span>' + t("type_" + x) + '</span><span>' +
          '<button class="chip" data-act="lvl" data-arg="' + x + ':-1">−</button> <b>' + state.stats[x].level + '</b> ' +
          '<button class="chip" data-act="lvl" data-arg="' + x + ':1">+</button></span></div>';
      }).join("");
    }
    return html;
  }
  acts.lvl = function (arg) {
    var p = arg.split(":"), s = state.stats[p[0]];
    s.level = Math.min(10, Math.max(1, s.level + parseInt(p[1], 10)));
    readTasks(); render();
  };
  function readTasks() {
    if (!TYPES.some(function (x) { return state.types[x]; })) state.types.math = true;
    if ($("tPer")) state.tasksPer = Math.min(10, Math.max(1, parseInt($("tPer").value, 10) || 3));
    if ($("tMin")) state.minutes = Math.min(240, Math.max(1, parseInt($("tMin").value, 10) || 20));
    save();
  }
  function aiForm() {
    return '<p class="muted">' + t("apiKeyHint") + '</p>' +
      '<input id="aKey" type="password" placeholder="sk-ant-..." value="' + esc(state.apiKey) + '">' +
      '<label class="f">' + t("model") + '</label><select id="aModel">' + MODELS.map(function (m) {
        return '<option value="' + m + '"' + (state.model === m ? " selected" : "") + '>' + m + '</option>';
      }).join("") + '</select><div class="muted" style="margin-top:6px">' + t("modelHint") + '</div>' +
      '<div style="margin-top:12px"><button class="btn2" data-act="testKey">' + t("apiTest") + '</button></div><div id="keyRes"></div>';
  }
  function readAI() {
    state.apiKey = $("aKey").value.trim();
    state.model = $("aModel").value;
    save();
  }
  acts.testKey = function () {
    readAI();
    $("keyRes").innerHTML = '<div class="spinner"></div>';
    AI.testKey().then(function () {
      $("keyRes").innerHTML = '<div class="okbox" style="margin-top:10px">' + t("apiOk") + '</div>';
    }).catch(function (e) {
      $("keyRes").innerHTML = '<div class="warn" style="margin-top:10px">' + t("apiBad") + ': ' + esc(e.message) + '</div>';
    });
  };
  var appsCache = null;
  function appsList() {
    if (!NA) return '<p class="muted">—</p>';
    if (!appsCache) appsCache = JSON.parse(NA.getApps());
    var blocked = JSON.parse(NA.getBlocked());
    return '<div class="applist">' + appsCache.map(function (a) {
      var on = blocked.indexOf(a.pkg) >= 0;
      return '<div class="app"><span>' + esc(a.name) + '</span><button class="switch' + (on ? " on" : "") +
        '" data-act="toggleApp" data-arg="' + esc(a.pkg) + '"></button></div>';
    }).join("") + '</div>';
  }
  acts.toggleApp = function (pkg, el) {
    var blocked = JSON.parse(NA.getBlocked()), i = blocked.indexOf(pkg);
    if (i >= 0) blocked.splice(i, 1); else blocked.push(pkg);
    NA.setBlocked(JSON.stringify(blocked));
    el.classList.toggle("on");
  };

  // ---------- главный экран ребёнка ----------
  function renderHome() {
    screen = "home";
    var lock = isLock(), app = targetName();
    var left = unlockUntil() - Date.now();
    var limitLeft = state.dailyLimit - earnedToday();
    var accOff = NA && !NA.isAccessibilityOn();
    var head = lock && app
      ? '<h1>🔒 ' + esc(t("locked", { app: app })) + '</h1><div class="sub">' + esc(t("lockText", { n: state.tasksPer, m: state.minutes })) + '</div>'
      : '<h1>' + esc(t("hello", { name: state.profile.name || "👋" })) + '</h1><div class="sub">' + esc(t("earnText", { n: state.tasksPer, m: state.minutes })) + '</div>';
    setHTML('<div class="top"><div class="row"><div>' + head + '</div></div></div><div class="wrap">' +
      (accOff ? '<div class="warn" style="margin-bottom:12px">' + t("setupWarn") + '</div>' : '') +
      '<div class="card center"><div class="muted">' + t("timeLeft") + '</div><div class="big" id="left">' +
      (left > 0 ? fmtTime(left) : "0:00") + '</div>' +
      '<div class="muted">' + esc(t("todayEarned", { m: earnedToday() })) + '</div></div>' +
      (limitLeft <= 0 ? '<div class="card">' + t("dailyLimitReached") + '</div>'
        : '<button class="btn" data-act="startSession">' + t("earnTime") + '</button>') +
      (lock && left > 0 && app ? '<div style="margin-top:10px"><button class="btn-ok" data-act="openTarget">' + esc(t("openApp", { app: app })) + '</button></div>' : '') +
      '<div style="margin-top:24px" class="center"><button class="btn2" style="width:auto" data-act="parent">🔑 ' + t("parent") + '</button></div>' +
      '</div>');
    timer = setInterval(function () {
      var l = unlockUntil() - Date.now();
      var el = $("left");
      if (el) el.textContent = l > 0 ? fmtTime(l) : "0:00";
    }, 1000);
  }
  acts.openTarget = function () { if (NA) NA.openTarget(); };
  acts.parent = function () { screen = "pin"; render(); };

  // ---------- сессия заданий ----------
  var session = null;

  function availableTypes() {
    var speech = NA ? NA.speechAvailable() : false;
    var list = TYPES.filter(function (x) {
      if (!state.types[x]) return false;
      if (x === "read_aloud" && (!speech || (session && session.noSpeech))) return false;
      if (x === "language" && !state.learnLangs.length) return false;
      return true;
    });
    return list.length ? list : ["math"];
  }

  function pickType() {
    var list = availableTypes();
    if (list.length > 1 && session && session.lastType) {
      list = list.filter(function (x) { return x !== session.lastType; });
    }
    var weights = list.map(function (x) {
      var s = state.stats[x];
      var fail = s.total >= 3 ? 1 - s.passed / s.total : 0.3;
      return 1 + 2 * fail;
    });
    var sum = weights.reduce(function (a, b) { return a + b; }, 0), r = Math.random() * sum;
    for (var i = 0; i < list.length; i++) { r -= weights[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }

  function genTask() {
    var type = pickType();
    if (session) session.lastType = type;
    var lang = type === "language" ? rand(state.learnLangs) : rand(state.taskLangs);
    var s = state.stats[type];
    return AI.generate(type, {
      profile: state.profile, lang: lang, uiLang: state.uiLang, level: s.level,
      weak: s.mistakes.slice(-5), recent: state.recent.slice(-8)
    });
  }

  function ctx() { return { profile: state.profile, uiLang: state.uiLang }; }

  acts.startSession = function () {
    if (!state.apiKey) return toast(t("noApiKey"));
    if (state.dailyLimit - earnedToday() <= 0) return renderHome();
    session = { target: targetName(), done: 0, needed: state.tasksPer, task: null, next: null, finished: false, lastType: null };
    screen = "session";
    loadTask();
  };

  function loadTask() {
    session.task = null; session.result = null; session.phase = null;
    renderSessionScreen();
    var p = session.next || genTask();
    session.next = null;
    p.then(function (task) {
      if (!session) return;
      session.task = task;
      session.phase = task.type === "retell" ? "read" : "answer";
      session.shownAt = Date.now();
      renderSessionScreen();
      // заранее готовим следующее задание
      if (session.done + 1 < session.needed) session.next = genTask().catch(function () { return genTask(); });
    }).catch(function (e) {
      if (!session) return;
      session.error = errText(e);
      renderSessionScreen();
    });
  }
  acts.retryTask = function () { session.error = null; session.next = null; loadTask(); };

  function header() {
    var pct = Math.round(session.done * 100 / session.needed);
    var shown = Math.min(session.done + 1, session.needed);
    return '<div class="top"><div class="row"><h1>' + esc(t("taskOf", { i: shown, n: session.needed })) + '</h1>' +
      '<button class="link" style="flex:0" data-act="quitSession">✕</button></div>' +
      '<div class="progress"><div style="width:' + pct + '%"></div></div></div>';
  }
  acts.quitSession = function () { session = null; screen = "home"; render(); };

  function renderSessionScreen() {
    if (!session) { screen = "home"; return renderHome(); }
    if (session.finished) return renderFinished();
    if (session.error) {
      return setHTML(header() + '<div class="wrap"><div class="card"><div class="warn">' + esc(session.error) +
        '</div><div style="margin-top:12px"><button class="btn" data-act="retryTask">' + t("retry") + '</button></div></div></div>');
    }
    var task = session.task;
    if (!task) {
      return setHTML(header() + '<div class="wrap"><div class="card center"><div class="spinner"></div><div class="muted">' + t("generating") + '</div></div></div>');
    }
    var body = '<span class="badge">' + t("type_" + task.type) + ' · ' + t("level") + ' ' + state.stats[task.type].level + '</span>' +
      '<h2 style="margin-top:10px">' + esc(task.title || "") + '</h2>';
    var r = session.result;
    switch (task.type) {
      case "math": body += inputTask(task, task.question, true); break;
      case "logic": body += choiceTask(task); break;
      case "language": body += (task.options && task.options.length >= 2) ? choiceTask(task) : inputTask(task, task.question, false); break;
      case "typing": body += typingTask(task); break;
      case "writing": body += writingTask(task); break;
      case "read_aloud": body += readAloudTask(task); break;
      case "retell": body += retellTask(task); break;
    }
    if (r) body += resultBlock(r);
    setHTML(header() + '<div class="wrap"><div class="card">' + body + '</div></div>');
    afterRender(task);
  }

  function resultBlock(r) {
    var html = '<div class="fb ' + (r.passed ? "ok" : "bad") + '"><b>' + (r.passed ? t("correct") : t("wrong")) + '</b>' +
      (r.score != null ? ' · ' + t("score") + ': ' + r.score : '') +
      (r.feedback ? '<div style="margin-top:6px">' + esc(r.feedback) + '</div>' : '') +
      (r.extra ? '<div style="margin-top:6px">' + r.extra + '</div>' : '') + '</div>';
    html += '<div style="margin-top:12px">' + (r.passed
      ? '<button class="btn" data-act="nextTask">' + t("nextTask") + '</button>'
      : '<button class="btn" data-act="anotherTask">' + t("tryAnother") + '</button>') + '</div>';
    return html;
  }
  acts.nextTask = function () {
    if (session.done >= session.needed) return finishSession();
    loadTask();
  };
  acts.anotherTask = function () { loadTask(); };

  function checkingBlock() { return '<div class="center"><div class="spinner"></div><div class="muted">' + t("checking") + '</div></div>'; }
  function locked() { return session.result || session.checking; }

  // --- ввод короткого ответа ---
  function inputTask(task, question, isMath) {
    return '<div class="task-text">' + esc(question) + '</div>' +
      '<label class="f">' + t("yourAnswer") + '</label><input id="ans" type="text" ' + (isMath ? 'inputmode="decimal"' : '') +
      (locked() ? " disabled" : "") + ' value="' + esc(session.answer || "") + '">' +
      (task.hint && !locked() ? '<div id="hintBox" style="margin-top:8px"><button class="btn2" style="width:auto" data-act="hint">💡 ' + t("hint") + '</button></div>' : '') +
      (session.checking ? checkingBlock() : !session.result ? '<div style="margin-top:12px"><button class="btn" data-act="checkInput">' + t("check") + '</button></div>' : '');
  }
  acts.hint = function () { $("hintBox").innerHTML = '<div class="muted">💡 ' + esc(session.task.hint) + '</div>'; session.usedHint = true; };
  acts.checkInput = function () {
    var task = session.task, ans = $("ans").value.trim();
    if (!ans) return;
    session.answer = ans;
    if (task.answer && AI.sameAnswer(ans, task.answer)) {
      return finishTask({ passed: true, score: 100, feedback: task.explanation || "" });
    }
    session.checking = true; renderSessionScreen();
    AI.checkAnswer(task, ans, ctx()).then(function (r) {
      session.checking = false;
      finishTask({ passed: !!r.passed, score: r.score, feedback: r.feedback, mistake: r.mistake, skill: r.skill });
    }).catch(function (e) { session.checking = false; toast(errText(e)); renderSessionScreen(); });
  };

  // --- выбор варианта ---
  function choiceTask(task) {
    var r = session.result;
    return '<div class="task-text">' + esc(task.question) + '</div>' + task.options.map(function (o, i) {
      var cls = "";
      if (r) { if (i === Number(task.correct_index)) cls = " right"; else if (i === session.choice) cls = " wrong"; }
      return '<button class="opt' + cls + '" data-act="choose" data-arg="' + i + '"' + (r ? " disabled" : "") + '>' + esc(o) + '</button>';
    }).join("");
  }
  acts.choose = function (i) {
    if (session.result) return;
    var task = session.task;
    session.choice = parseInt(i, 10);
    var ok = session.choice === Number(task.correct_index);
    finishTask({ passed: ok, score: ok ? 100 : 0, feedback: task.explanation || "",
      mistake: ok ? "" : (task.question + " → " + task.options[session.choice]).slice(0, 140), skill: task.skill });
  };

  // --- набор текста ---
  function typingTask(task) {
    return '<p class="muted">' + t("typingInstr") + '</p><div class="task-text noselect" style="background:#F3F4F6;padding:12px;border-radius:12px">' + esc(task.text) + '</div>' +
      '<label class="f">' + t("yourAnswer") + '</label><textarea id="typed" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"' +
      (locked() ? " disabled" : "") + '>' + esc(session.answer || "") + '</textarea>' +
      (!session.result ? '<div style="margin-top:12px"><button class="btn" data-act="checkTyping">' + t("check") + '</button></div>' : '');
  }
  acts.checkTyping = function () {
    var task = session.task, typed = $("typed").value;
    if (!typed.trim()) return;
    session.answer = typed;
    var acc = AI.typingScore(task.text, typed);
    var secs = Math.max(1, (Date.now() - (session.typeStart || session.shownAt)) / 1000);
    var cpm = Math.round(typed.length * 60 / secs);
    var need = state.profile.age <= 8 ? 85 : 92;
    var ok = acc >= need;
    finishTask({ passed: ok, score: acc, feedback: t("accuracy") + ": " + acc + "% · " + t("speed") + ": " + cpm + " " + t("wpm"),
      mistake: ok ? "" : "точность набора " + acc + "%", skill: ok ? "" : "аккуратность набора" });
  };

  // --- письмо ---
  function writingTask(task) {
    return '<div class="task-text">' + esc(task.prompt) + '</div><p class="muted">' + t("writingInstr") + '</p>' +
      '<textarea id="written"' + (locked() ? " disabled" : "") + '>' + esc(session.answer || "") + '</textarea>' +
      (session.checking ? checkingBlock() : !session.result ? '<div style="margin-top:12px"><button class="btn" data-act="checkWriting">' + t("check") + '</button></div>' : '');
  }
  acts.checkWriting = function () {
    var task = session.task, txt = $("written").value.trim();
    if (txt.length < 10) return;
    session.answer = txt; session.checking = true; renderSessionScreen();
    AI.checkWriting(task, txt, ctx()).then(function (r) {
      session.checking = false;
      finishTask({ passed: !!r.passed, score: r.score, feedback: r.feedback, mistake: r.mistake, skill: r.skill,
        extra: r.corrected ? "✏️ " + esc(r.corrected) : "" });
    }).catch(function (e) { session.checking = false; toast(errText(e)); renderSessionScreen(); });
  };

  // --- чтение вслух ---
  function micUI(id) {
    return '<button class="mic" id="' + id + '" data-act="micToggle">🎤</button><div class="center muted" id="micState"></div>';
  }
  function readAloudTask(task) {
    var done = !!session.result;
    return '<p class="muted">' + t("readAloudInstr") + '</p><div class="task-text">' + esc(task.text) + '</div>' +
      (done ? '' : micUI("micBtn")) +
      '<label class="f">' + t("transcript") + '</label><div id="trans" class="muted" style="min-height:40px">' + esc(session.answer || "") + '</div>' +
      (!done ? '<div id="speechErr"></div>' : '');
  }

  // --- пересказ ---
  function retellTask(task) {
    if (session.phase === "read") {
      var words = AI.normWords(task.text).length;
      session.minRead = Math.max(10, Math.round(words * 0.3));
      return '<p class="muted">' + t("retellInstr") + '</p><div class="task-text">' + esc(task.text) + '</div>' +
        '<div style="margin-top:12px"><button class="btn" id="readDone" data-act="readDone" disabled>' + t("wait", { s: session.minRead }) + '</button></div>';
    }
    var done = !!session.result;
    return '<p class="muted">' + t("retellNow") + '</p>' + (done || session.checking ? '' : micUI("micBtn")) +
      '<label class="f">' + t("orType") + '</label><textarea id="retold"' + (locked() ? " disabled" : "") + '>' + esc(session.answer || "") + '</textarea>' +
      '<div id="speechErr"></div>' +
      (session.checking ? checkingBlock() : !done ? '<div style="margin-top:12px"><button class="btn" data-act="checkRetell">' + t("check") + '</button></div>' : '') +
      (done ? '<h3>' + esc(task.title || "") + '</h3><div class="muted">' + esc(task.text) + '</div>' : '');
  }
  acts.readDone = function () { session.phase = "retell"; session.answer = ""; renderSessionScreen(); };
  acts.checkRetell = function () {
    var task = session.task, txt = $("retold").value.trim();
    if (txt.length < 10) return;
    Speech.stop(true);
    session.answer = txt; session.checking = true; renderSessionScreen();
    AI.checkRetell(task, txt, ctx()).then(function (r) {
      session.checking = false;
      var missed = (r.missed_points || []).filter(Boolean);
      finishTask({ passed: !!r.passed, score: r.score, feedback: r.feedback, mistake: r.mistake, skill: r.skill,
        extra: missed.length ? esc(missed.join(" · ")) : "" });
    }).catch(function (e) { session.checking = false; toast(errText(e)); renderSessionScreen(); });
  };

  acts.micToggle = function () {
    var task = session.task;
    if (Speech.on) {
      Speech.stop(false);
      if (task.type === "read_aloud") {
        var st = $("micState"); if (st) st.textContent = t("checking");
        setTimeout(function () { if (session && session.task === task && !session.result) finishReadAloud(); }, 1200);
      }
      return;
    }
    var lang = task.lang || "ru";
    Speech.start(lang, {
      state: function (on) {
        var b = $("micBtn"); if (b) b.classList.toggle("rec", on);
        var s = $("micState"); if (s) s.textContent = on ? t("listening") : "";
      },
      text: function (txt) {
        if (task.type === "read_aloud") { session.answer = txt; var tr = $("trans"); if (tr) tr.textContent = txt; }
        else {
          var ta = $("retold");
          if (ta) { if (session.base == null) session.base = ta.value ? ta.value + " " : ""; ta.value = session.base + txt; session.answer = ta.value; }
        }
      },
      error: function (msg) {
        var e = $("speechErr");
        if (task.type === "read_aloud") {
          session.noSpeech = true;
          if (e) e.innerHTML = '<div class="warn" style="margin-top:10px">' + esc(msg) + '</div><div style="margin-top:10px"><button class="btn" data-act="anotherTask">' + t("tryAnother") + '</button></div>';
        } else if (e) e.innerHTML = '<div class="warn" style="margin-top:10px">' + esc(msg) + '</div>';
      }
    });
    session.base = null;
  };

  function finishReadAloud() {
    var task = session.task, said = session.answer || "";
    if (!said.trim()) return;
    var sc = AI.readAloudScore(task.text, said);
    var need = state.profile.age <= 8 ? 70 : 75;
    var ok = sc.accuracy >= need;
    finishTask({ passed: ok, score: sc.accuracy, feedback: t("accuracy") + ": " + sc.accuracy + "%",
      extra: sc.missed.length ? t("missedWords") + ": " + esc(sc.missed.slice(0, 15).join(", ")) : "",
      mistake: ok ? "" : "пропущены слова при чтении: " + sc.missed.slice(0, 6).join(", "), skill: ok ? "" : "техника чтения" });
  }

  function afterRender(task) {
    var ta = $("typed");
    if (ta) {
      ta.addEventListener("paste", function (e) { e.preventDefault(); });
      ta.addEventListener("input", function () { if (!session.typeStart) session.typeStart = Date.now(); session.answer = ta.value; });
    }
    var wr = $("written"); if (wr) wr.addEventListener("input", function () { session.answer = wr.value; });
    var rt = $("retold"); if (rt) rt.addEventListener("input", function () { session.answer = rt.value; session.base = null; });
    var an = $("ans"); if (an) an.addEventListener("input", function () { session.answer = an.value; });
    if (task.type === "retell" && session.phase === "read") {
      var left = session.minRead - Math.floor((Date.now() - session.shownAt) / 1000);
      var tick = function () {
        var b = $("readDone"); if (!b) return;
        if (left <= 0) { b.disabled = false; b.textContent = t("iRead"); if (timer) { clearInterval(timer); timer = null; } }
        else b.textContent = t("wait", { s: left });
        left--;
      };
      tick();
      timer = setInterval(tick, 1000);
    }
  }

  // ---------- результат задания ----------
  function finishTask(r) {
    var task = session.task, s = state.stats[task.type];
    if (r.score != null) r.score = Math.round(Number(r.score) || 0);
    s.total++;
    if (r.passed) {
      s.passed++; s.streak++;
      if (s.streak >= 2) { s.level = Math.min(10, s.level + 1); s.streak = 0; }
      session.done++;
    } else {
      s.streak = 0; s.level = Math.max(1, s.level - 1);
      var m = [r.skill, r.mistake].filter(Boolean).join(": ");
      if (m) { s.mistakes.push(m.slice(0, 160)); if (s.mistakes.length > 10) s.mistakes.shift(); }
    }
    state.history.push({ t: Date.now(), type: task.type, lang: task.lang, title: task.title || "", passed: !!r.passed, score: r.score });
    if (state.history.length > 300) state.history.shift();
    state.recent.push((task.title || task.skill || "").slice(0, 60));
    if (state.recent.length > 15) state.recent.shift();
    save();
    session.result = r;
    renderSessionScreen();
  }

  function finishSession() {
    var grant = Math.min(state.minutes, state.dailyLimit - earnedToday());
    if (grant > 0) {
      if (NA) NA.grantMinutes(grant);
      if (state.earned.date !== today()) state.earned = { date: today(), minutes: 0 };
      state.earned.minutes += grant;
      save();
    }
    session.granted = Math.max(0, grant);
    session.finished = true;
    renderSessionScreen();
  }

  function renderFinished() {
    var app = session.target;
    setHTML('<div class="top"><h1>' + t("finished") + '</h1><div class="progress"><div style="width:100%"></div></div></div>' +
      '<div class="wrap"><div class="card center"><div style="font-size:60px">🏆</div>' +
      '<div class="big">+' + session.granted + ' ' + t("min") + '</div><p>' + esc(t("finishedText", { m: session.granted })) + '</p>' +
      (session.granted <= 0 ? '<p class="muted">' + t("dailyLimitReached") + '</p>' : '') + '</div>' +
      (app && session.granted > 0 ? '<button class="btn-ok" data-act="openTarget">' + esc(t("openApp", { app: app })) + '</button><div style="height:10px"></div>' : '') +
      '<button class="btn2" data-act="toHome">' + t("goHome") + '</button></div>');
  }
  acts.toHome = function () { session = null; if (NA && isLock()) NA.goHome(); screen = "home"; render(); };

  // ---------- PIN и панель родителя ----------
  function renderPin() {
    setHTML('<div class="top"><h1>🔑 ' + t("parentTitle") + '</h1></div><div class="wrap"><div class="card">' +
      '<label class="f">' + t("enterPin") + '</label><input id="pinIn" type="password" inputmode="numeric" maxlength="6" class="pin">' +
      '<div style="margin-top:14px" class="grid2"><button class="btn2" data-act="pinCancel">' + t("cancel") + '</button>' +
      '<button class="btn" data-act="pinOk">' + t("next") + '</button></div></div></div>');
    setTimeout(function () { var p = $("pinIn"); if (p) p.focus(); }, 100);
  }
  acts.pinCancel = function () { screen = "home"; render(); };
  acts.pinOk = function () {
    if ($("pinIn").value.trim() !== state.pin) { toast(t("wrongPin")); $("pinIn").value = ""; return; }
    if (NA) NA.setParentMinutes(15);
    screen = "parent"; parentTab = "time"; render();
  };
  function exitParent() {
    if (NA) NA.setParentMinutes(0);
    screen = "home"; render();
  }
  acts.exitParent = exitParent;

  var parentTab = "time";
  var TABS = ["time", "tasks", "report", "profile", "apps", "ai", "protect"];
  var TAB_KEYS = { time: "tabTime", tasks: "tabTasks", report: "tabReport", profile: "tabProfile", apps: "tabApps", ai: "tabAI", protect: "tabProtect" };
  acts.tab = function (x) { parentTab = x; render(); };

  function renderParent() {
    var tabs = '<div class="tabs">' + TABS.map(function (x) {
      return '<button class="tab' + (parentTab === x ? " on" : "") + '" data-act="tab" data-arg="' + x + '">' + t(TAB_KEYS[x]) + '</button>';
    }).join("") + '</div>';
    var body = "";
    if (parentTab === "time") {
      var until = unlockUntil();
      body = '<div class="card"><h2>' + t("tabTime") + '</h2>' +
        '<div class="muted">' + (until > Date.now() ? esc(t("unlockedUntil", { t: clock(until) })) : t("noTime")) + ' · ' + esc(t("todayEarned", { m: earnedToday() })) + '</div>' +
        '<h3>' + t("giveTime") + '</h3><div class="grid2"><button class="btn2" data-act="give" data-arg="15">+15 ' + t("min") + '</button>' +
        '<button class="btn2" data-act="give" data-arg="30">+30 ' + t("min") + '</button>' +
        '<button class="btn2" data-act="give" data-arg="60">+60 ' + t("min") + '</button>' +
        '<button class="btn-bad" data-act="lockNow">' + t("lockNowBtn") + '</button></div>' +
        '<label class="f">' + t("dailyLimit") + '</label><input id="dLim" type="number" min="0" max="1440" value="' + state.dailyLimit + '">' +
        '<div class="app" style="display:flex;justify-content:space-between;align-items:center;margin-top:14px"><span>' + t("blockingEnabled") + '</span>' +
        '<button class="switch' + (NA && NA.getEnabled() ? " on" : "") + '" data-act="toggleEnabled"></button></div>' +
        '<div style="margin-top:14px"><button class="btn" data-act="saveTime">' + t("save") + '</button></div></div>';
    } else if (parentTab === "tasks") {
      body = '<div class="card"><h2>' + t("taskTypes") + '</h2>' + tasksForm(true) +
        '<div style="margin-top:14px"><button class="btn" data-act="saveTasks">' + t("save") + '</button></div></div>';
    } else if (parentTab === "report") {
      body = reportView();
    } else if (parentTab === "profile") {
      body = '<div class="card"><h2>' + t("childProfile") + '</h2>' + profileForm() +
        '<label class="f">' + t("uiLang") + '</label>' + chips("uiLang", LANGS, [state.uiLang], langLabel) +
        '<div style="margin-top:14px"><button class="btn" data-act="saveProfile">' + t("save") + '</button></div></div>';
    } else if (parentTab === "apps") {
      body = '<div class="card"><h2>' + t("chooseApps") + '</h2><p class="muted">' + t("chooseAppsHint") + '</p>' + appsList() + '</div>';
    } else if (parentTab === "ai") {
      body = '<div class="card"><h2>' + t("apiKey") + '</h2>' + aiForm() +
        '<div style="margin-top:14px"><button class="btn" data-act="saveAI">' + t("save") + '</button></div></div>';
    } else if (parentTab === "protect") {
      body = '<div class="card"><h2>' + t("tabProtect") + '</h2>' + permBlock() +
        '<div class="app" style="display:flex;justify-content:space-between;align-items:center;margin-top:16px"><b>' + t("protectMode") + '</b>' +
        '<button class="switch' + (NA && NA.getProtect() ? " on" : "") + '" data-act="toggleProtect"></button></div>' +
        '<p class="muted">' + t("protectText") + '</p>' +
        '<label class="f">' + t("changePin") + '</label><input id="newPin" type="password" inputmode="numeric" maxlength="6" class="pin">' +
        '<div style="margin-top:10px"><button class="btn2" data-act="savePin">' + t("save") + '</button></div>' +
        '<div style="margin-top:20px"><button class="btn-bad" data-act="resetStats">' + t("resetStats") + '</button></div></div>';
    }
    setHTML('<div class="top"><div class="row"><h1>🔑 ' + t("parentTitle") + '</h1>' +
      '<button class="link" style="flex:0;white-space:nowrap" data-act="exitParent">✕</button></div>' +
      '<div class="sub">' + t("parentModeNote") + '</div></div>' + tabs + '<div class="wrap">' + body + '</div>');
  }

  acts.give = function (m) { if (NA) NA.grantMinutes(parseInt(m, 10)); toast("+" + m + " " + t("min")); render(); };
  acts.lockNow = function () { if (NA) NA.lockNow(); toast(t("saved")); render(); };
  acts.toggleEnabled = function (a, el) { var v = !NA.getEnabled(); NA.setEnabled(v); el.classList.toggle("on", v); };
  acts.toggleProtect = function (a, el) { var v = !NA.getProtect(); NA.setProtect(v); el.classList.toggle("on", v); };
  acts.saveTime = function () {
    state.dailyLimit = Math.max(0, parseInt($("dLim").value, 10) || 0); save(); toast(t("saved"));
  };
  acts.saveTasks = function () { readTasks(); toast(t("saved")); };
  acts.saveProfile = function () { readProfile(); toast(t("saved")); };
  acts.saveAI = function () { readAI(); toast(t("saved")); };
  acts.savePin = function () {
    var p = $("newPin").value.trim();
    if (!/^\d{4,6}$/.test(p)) return toast(t("pinShort"));
    state.pin = p; save(); toast(t("saved")); $("newPin").value = "";
  };
  acts.resetStats = function () {
    if (!confirmReset) { confirmReset = true; toast(t("confirmReset")); return; }
    confirmReset = false;
    var d = defaults();
    state.stats = d.stats; state.history = []; state.recent = [];
    save(); toast(t("saved")); render();
  };
  var confirmReset = false;

  function reportView() {
    var html = '<div class="card"><h2>' + t("tabReport") + '</h2>';
    var any = false;
    TYPES.forEach(function (x) {
      var s = state.stats[x];
      if (!s.total) return;
      any = true;
      html += '<h3>' + t("type_" + x) + ' <span class="lvl">· ' + t("level") + ' ' + s.level + '</span></h3>' +
        '<div class="stat"><span>' + t("passed") + ' / ' + t("attempts") + '</span><b>' + s.passed + ' / ' + s.total +
        ' (' + Math.round(s.passed * 100 / s.total) + '%)</b></div>' +
        (s.mistakes.length ? '<div class="muted" style="margin-top:6px">' + t("recentMistakes") + ': ' + esc(s.mistakes.slice(-3).join(" · ")) + '</div>' : '');
    });
    if (!any) html += '<p class="muted">' + t("noData") + '</p>';
    html += '</div>';
    if (any) {
      html += '<div class="card"><h2>' + t("aiSummary") + '</h2><div id="sumBox"><button class="btn2" data-act="summary">✨ ' + t("aiSummary") + '</button></div></div>';
      var last = state.history.slice(-15).reverse();
      html += '<div class="card"><h2>' + t("history") + '</h2>' + last.map(function (h) {
        var d = new Date(h.t);
        return '<div class="stat"><span>' + (h.passed ? "✅" : "❌") + ' ' + esc(t("type_" + h.type)) + ' · ' + esc(h.title) + '</span>' +
          '<span class="muted">' + d.getDate() + '.' + (d.getMonth() + 1) + ' ' + clock(h.t) + '</span></div>';
      }).join("") + '</div>';
    }
    return html;
  }
  acts.summary = function () {
    var box = $("sumBox");
    box.innerHTML = '<div class="spinner"></div>';
    var lines = [ "Профиль: " + JSON.stringify(state.profile) ];
    TYPES.forEach(function (x) {
      var s = state.stats[x];
      if (s.total) lines.push(x + ": уровень " + s.level + "/10, выполнено " + s.passed + " из " + s.total + ". Ошибки: " + s.mistakes.join("; "));
    });
    AI.summary(lines.join("\n"), state.uiLang).then(function (txt) {
      box.innerHTML = '<div class="task-text" style="font-size:16px">' + esc(txt) + '</div>';
    }).catch(function (e) { box.innerHTML = '<div class="warn">' + esc(errText(e)) + '</div>'; });
  };

  render();
})();
