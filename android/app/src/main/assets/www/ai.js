// Работа с Claude: генерация и проверка заданий, локальные проверки
var AI = (function () {
  var cbs = {}, seq = 0;

  window.__claudeCb = function (id, payload) {
    var cb = cbs[id];
    if (!cb) return;
    delete cbs[id];
    try {
      var p = JSON.parse(payload);
      if (p.status >= 200 && p.status < 300) {
        var data = JSON.parse(p.body);
        var text = (data.content || []).filter(function (c) { return c.type === "text"; })
          .map(function (c) { return c.text; }).join("");
        cb.res(text);
      } else {
        var msg = "HTTP " + p.status;
        try { msg += ": " + JSON.parse(p.body).error.message; } catch (e) { msg += " " + String(p.body).slice(0, 200); }
        cb.rej(new Error(msg));
      }
    } catch (e) { cb.rej(e); }
  };

  function call(system, user, maxTokens) {
    var s = App.settings();
    if (!s.apiKey) return Promise.reject(new Error("NO_KEY"));
    var body = JSON.stringify({
      model: s.model || "claude-sonnet-5-5",
      max_tokens: maxTokens || 1500,
      system: system,
      messages: [{ role: "user", content: user }]
    });
    return new Promise(function (res, rej) {
      var id = ++seq;
      cbs[id] = { res: res, rej: rej };
      setTimeout(function () {
        if (cbs[id]) { delete cbs[id]; rej(new Error("TIMEOUT")); }
      }, 130000);
      if (window.Android) Android.callClaude(id, s.apiKey, body);
      else rej(new Error("NO_ANDROID"));
    });
  }

  function extractJSON(text) {
    var a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a < 0 || b < a) throw new Error("BAD_JSON");
    return JSON.parse(text.slice(a, b + 1));
  }

  function callJSON(system, user, maxTokens) {
    return call(system, user, maxTokens).then(extractJSON).catch(function (e) {
      if (e.message === "BAD_JSON" || e instanceof SyntaxError) {
        // одна повторная попытка, если модель вернула не JSON
        return call(system, user + "\n\nВерни ТОЛЬКО корректный JSON.", maxTokens).then(extractJSON);
      }
      throw e;
    });
  }

  var LANG_NAMES = { ru: "русский", kk: "казахский (қазақ тілі, кириллица)", en: "английский" };

  function profileText(p) {
    return "Ребёнок: " + (p.name || "ребёнок") + ", возраст " + (p.age || "?") + " лет, класс " + (p.grade || "?") +
      ". Интересы: " + (p.interests || "не указаны") + ".";
  }

  var TYPE_SPECS = {
    math: 'Задача по математике (арифметика, дроби, уравнения, геометрия, текстовые задачи — по возрасту и уровню). ' +
      'JSON: {"title":"...","question":"текст задачи","answer":"короткий правильный ответ (число или выражение)","hint":"подсказка без ответа","skill":"узкий навык, напр. \'деление с остатком\'"}',
    logic: 'Вопрос на логику или общие знания (природа, наука, география, история, логические загадки) с 4 вариантами ответа. ' +
      'JSON: {"title":"...","question":"...","options":["A","B","C","D"],"correct_index":0,"explanation":"короткое объяснение","skill":"..."}',
    read_aloud: 'Короткий текст для чтения вслух. Длина по возрасту: 6–8 лет 25–45 слов, 9–11 лет 50–80 слов, 12–15 лет 80–120 слов. Интересный, связанный с интересами ребёнка. ' +
      'JSON: {"title":"...","text":"...","skill":"..."}',
    retell: 'Текст для пересказа (рассказ или познавательный текст). Длина: 6–8 лет 50–80 слов, 9–11 лет 90–140 слов, 12–15 лет 140–200 слов. ' +
      'JSON: {"title":"...","text":"...","key_points":["главная мысль 1","2","3","4"],"skill":"..."}',
    typing: 'Текст для набора на клавиатуре: 6–8 лет одно предложение 5–9 слов, 9–11 лет 1–2 предложения 12–20 слов, 12–15 лет 2–3 предложения 20–35 слов. Без редких символов и кавычек-ёлочек. ' +
      'JSON: {"title":"...","text":"...","skill":"..."}',
    writing: 'Письменное задание: ответить на вопрос, описать, придумать продолжение (2–6 предложений по возрасту). Проверяется грамотность и смысл. ' +
      'JSON: {"title":"...","prompt":"формулировка задания","min_sentences":2,"skill":"..."}',
    language: 'Задание по изучаемому иностранному языку: слова, перевод, грамматика. Формулировку и объяснение пиши на языке интерфейса, а языковой материал — на изучаемом языке. ' +
      'Если подходит выбор — дай 4 варианта; если нужен ввод — без вариантов. ' +
      'JSON: {"title":"...","question":"...","options":["..."] или [],"correct_index":0,"answer":"правильный ответ для ввода","explanation":"...","skill":"..."}'
  };

  function generate(type, ctx) {
    var p = ctx.profile;
    var lang = ctx.lang; // язык задания
    var sys = "Ты — опытный педагог и автор развивающих заданий для детей. Ты создаёшь ОДНО задание для приложения, которое разблокирует телефон ребёнку после выполнения. " +
      "Задание должно быть интересным, коротким (1–3 минуты), безопасным и подходящим по возрасту. " +
      "Используй интересы ребёнка в сюжете, когда это уместно. Отвечай ТОЛЬКО одним JSON-объектом без markdown.";
    var usr = profileText(p) + "\n" +
      "Тип задания: " + TYPE_SPECS[type] + "\n" +
      (type === "language"
        ? "Изучаемый язык: " + LANG_NAMES[lang] + ". Язык интерфейса (для формулировок): " + LANG_NAMES[ctx.uiLang] + ".\n"
        : "Язык задания: " + LANG_NAMES[lang] + ". Весь текст задания — на этом языке.\n") +
      "Уровень сложности: " + ctx.level + " из 10 (5 — норма для возраста/класса, 1 — намного легче, 10 — олимпиадный).\n" +
      (ctx.weak && ctx.weak.length ? "Недавние ошибки ребёнка (дай задание, которое тренирует эти места, но не повторяй дословно): " + ctx.weak.join("; ") + "\n" : "") +
      (ctx.recent && ctx.recent.length ? "Не повторяй эти недавние темы: " + ctx.recent.join("; ") + "\n" : "") +
      "Случайное зерно для разнообразия: " + Math.floor(Math.random() * 100000);
    return callJSON(sys, usr, 1200).then(function (t) { t.type = type; t.lang = lang; return t; });
  }

  function checkSystem(uiLang) {
    return "Ты — добрый и точный учитель. Ты проверяешь ответ ребёнка. Отзыв пиши на языке: " + LANG_NAMES[uiLang] +
      ", коротко (1–3 предложения), по-доброму, с конкретным объяснением ошибки. Отвечай ТОЛЬКО JSON.";
  }

  var CHECK_FORMAT = 'JSON: {"passed":true/false,"score":0-100,"feedback":"отзыв ребёнку","mistake":"кратко, в чём ошибка (пусто, если нет)","skill":"навык, который надо подтянуть (пусто, если всё хорошо)"}';

  function checkAnswer(task, answer, ctx) {
    var usr = profileText(ctx.profile) + "\nЗадание: " + (task.question || task.prompt) +
      (task.answer ? "\nЭталонный ответ: " + task.answer : "") +
      "\nОтвет ребёнка: " + answer +
      "\nЗасчитай ответ, если он верен по сути (эквивалентная форма, единицы, мелкая опечатка в слове допустимы)." +
      "\n" + CHECK_FORMAT;
    return callJSON(checkSystem(ctx.uiLang), usr, 600);
  }

  function checkWriting(task, answer, ctx) {
    var usr = profileText(ctx.profile) + "\nЯзык ответа: " + LANG_NAMES[task.lang] +
      "\nПисьменное задание: " + task.prompt +
      "\nМинимум предложений: " + (task.min_sentences || 2) +
      "\nОтвет ребёнка: " + answer +
      "\nОцени смысл, полноту и грамотность с учётом возраста. passed=true, если ответ по теме, достаточной длины и score ≥ 60. " +
      "Дополнительно верни поле \"corrected\" — исправленный вариант текста ребёнка." +
      "\n" + CHECK_FORMAT.replace("}", ',"corrected":"..."}');
    return callJSON(checkSystem(ctx.uiLang), usr, 900);
  }

  function checkRetell(task, retell, ctx) {
    var usr = profileText(ctx.profile) + "\nИсходный текст: " + task.text +
      "\nГлавные мысли: " + (task.key_points || []).join("; ") +
      "\nПересказ ребёнка (может быть получен распознаванием речи, поэтому игнорируй ошибки распознавания и пунктуацию): " + retell +
      "\nОцени, насколько полно и верно передан смысл. passed=true, если передано большинство главных мыслей и score ≥ 60. " +
      "Дополнительно верни поле \"missed_points\" — список пропущенных главных мыслей." +
      "\n" + CHECK_FORMAT.replace("}", ',"missed_points":["..."]}');
    return callJSON(checkSystem(ctx.uiLang), usr, 800);
  }

  function summary(statsText, uiLang) {
    var sys = "Ты — школьный психолог-педагог. Напиши родителю короткий понятный отчёт на языке: " + LANG_NAMES[uiLang] +
      ". Структура: сильные стороны; что подтянуть; 2–3 совета родителю. Без markdown-заголовков, коротко.";
    return call(sys, statsText, 900);
  }

  function testKey() {
    return call("Answer with one word.", "Say OK", 10);
  }

  // ---------- локальные проверки ----------

  function normWords(s) {
    return String(s || "").toLowerCase().replace(/ё/g, "е")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/-/g, " ")
      .split(/\s+/).filter(Boolean);
  }

  function lcsWords(a, b) {
    var n = a.length, m = b.length, i, j;
    var dp = [];
    for (i = 0; i <= n; i++) { dp.push(new Array(m + 1).fill(0)); }
    for (i = 1; i <= n; i++) for (j = 1; j <= m; j++) {
      dp[i][j] = near(a[i - 1], b[j - 1]) ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
    var matched = new Array(n).fill(false);
    i = n; j = m;
    while (i > 0 && j > 0) {
      if (near(a[i - 1], b[j - 1]) && dp[i][j] === dp[i - 1][j - 1] + 1) { matched[i - 1] = true; i--; j--; }
      else if (dp[i - 1][j] >= dp[i][j - 1]) i--; else j--;
    }
    return matched;
  }

  // слова считаются совпавшими, если отличаются не более чем на 1 букву (ошибки распознавания)
  function near(x, y) {
    if (x === y) return true;
    if (Math.abs(x.length - y.length) > 1 || x.length < 4) return false;
    return lev(x, y) <= 1;
  }

  function lev(a, b) {
    var m = a.length, n = b.length, prev = [], cur, i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  function readAloudScore(text, transcript) {
    var a = normWords(text), b = normWords(transcript);
    if (!a.length) return { accuracy: 0, missed: [] };
    var matched = lcsWords(a, b);
    var ok = matched.filter(Boolean).length;
    var missed = a.filter(function (w, i) { return !matched[i]; });
    return { accuracy: Math.round(ok * 100 / a.length), missed: missed };
  }

  function typingScore(text, typed) {
    var a = String(text).replace(/\s+/g, " ").trim(), b = String(typed).replace(/\s+/g, " ").trim();
    if (!a.length) return 0;
    var d = lev(a, b);
    return Math.max(0, Math.round((1 - d / a.length) * 100));
  }

  function sameAnswer(a, b) {
    var x = String(a || "").toLowerCase().replace(/\s+/g, "").replace(",", ".");
    var y = String(b || "").toLowerCase().replace(/\s+/g, "").replace(",", ".");
    if (!x || !y) return false;
    if (x === y) return true;
    var nx = parseFloat(x), ny = parseFloat(y);
    return !isNaN(nx) && !isNaN(ny) && /^-?[\d.]+$/.test(x) && /^-?[\d.]+$/.test(y) && Math.abs(nx - ny) < 1e-9;
  }

  return {
    generate: generate, checkAnswer: checkAnswer, checkWriting: checkWriting, checkRetell: checkRetell,
    summary: summary, testKey: testKey, readAloudScore: readAloudScore, typingScore: typingScore,
    sameAnswer: sameAnswer, normWords: normWords
  };
})();
