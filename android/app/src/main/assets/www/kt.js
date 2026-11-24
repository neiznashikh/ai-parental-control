// Bayesian Knowledge Tracing (BKT) — модель прогноза знаний ребёнка.
// Для каждого навыка (типа задания) модель хранит вероятность того, что навык освоен: P(L).
// Четыре параметра навыка:
//   p0 — начальная вероятность освоения
//   T  — вероятность освоить навык после одной попытки (обучение)
//   S  — вероятность ошибиться, даже зная навык (slip)
//   G  — вероятность угадать, не зная навыка (guess)
// Прогноз верного ответа:  P(correct) = P(L)·(1−S) + (1−P(L))·G
// После ответа — формула Байеса, затем переход: P(L) ← P(L|ответ) + (1−P(L|ответ))·T
var KT = (function () {
  var CHOICE = { logic: true, language: true };

  function defaults(type) {
    return { p0: 0.3, T: 0.12, S: 0.1, G: CHOICE[type] ? 0.25 : 0.1 };
  }

  function predict(pL, pr) {
    return pL * (1 - pr.S) + (1 - pL) * pr.G;
  }

  function update(pL, correct, pr) {
    var post;
    if (correct) post = pL * (1 - pr.S) / (pL * (1 - pr.S) + (1 - pL) * pr.G);
    else post = pL * pr.S / (pL * pr.S + (1 - pL) * (1 - pr.G));
    return post + (1 - post) * pr.T;
  }

  function clip(p) { return Math.min(0.999, Math.max(0.001, p)); }

  // логарифмическая функция потерь последовательности ответов
  function seqLoss(seq, pr) {
    var pL = pr.p0, loss = 0;
    for (var i = 0; i < seq.length; i++) {
      var p = clip(predict(pL, pr));
      loss -= seq[i] ? Math.log(p) : Math.log(1 - p);
      pL = update(pL, seq[i], pr);
    }
    return loss;
  }

  // «Обучение» модели: перебор параметров по сетке, минимизация log-loss
  var GRID = {
    p0: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
    T: [0.02, 0.05, 0.1, 0.15, 0.2, 0.3],
    S: [0.05, 0.1, 0.15, 0.2, 0.3],
    G: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3]
  };
  function fitSeq(seq, type) {
    if (seq.length < 10) return null;
    var best = null, bestLoss = Infinity;
    GRID.p0.forEach(function (p0) {
      GRID.T.forEach(function (T) {
        GRID.S.forEach(function (S) {
          GRID.G.forEach(function (G) {
            if (G + S >= 0.6) return; // модель должна оставаться «разумной»
            var pr = { p0: p0, T: T, S: S, G: G };
            var l = seqLoss(seq, pr);
            if (l < bestLoss) { bestLoss = l; best = pr; }
          });
        });
      });
    });
    return best;
  }

  function seqByType(history) {
    var m = {};
    history.forEach(function (h) {
      (m[h.type] = m[h.type] || []).push(h.passed ? 1 : 0);
    });
    return m;
  }

  // Обучает параметры для всех навыков, где достаточно данных
  function fitAll(history, types) {
    var seqs = seqByType(history), out = {};
    types.forEach(function (t) {
      var f = seqs[t] ? fitSeq(seqs[t], t) : null;
      out[t] = f || defaults(t);
      out[t].fitted = !!f;
      out[t].n = seqs[t] ? seqs[t].length : 0;
    });
    return out;
  }

  // Прогоняет историю через модель: текущее освоение и кривая по каждому навыку
  function trace(history, params, types) {
    var res = {};
    types.forEach(function (t) {
      var pr = params[t] || defaults(t);
      res[t] = { mastery: pr.p0, curve: [pr.p0], n: 0, correct: 0 };
    });
    history.forEach(function (h) {
      var r = res[h.type];
      if (!r) return;
      var pr = params[h.type] || defaults(h.type);
      r.mastery = update(r.mastery, !!h.passed, pr);
      r.curve.push(r.mastery);
      r.n++; if (h.passed) r.correct++;
    });
    return res;
  }

  // Честная оценка: обучаем на первых 70% попыток (по времени), проверяем на последних 30%.
  // Базовая модель для сравнения: «ребёнок ответит так, как чаще отвечал раньше».
  function evaluate(history, types) {
    if (history.length < 30) return null;
    var cut = Math.floor(history.length * 0.7);
    var train = history.slice(0, cut);
    var params = fitAll(train, types);
    var pL = {}, seen = 0, seenOk = 0;
    types.forEach(function (t) { pL[t] = (params[t] || defaults(t)).p0; });
    var n = 0, hit = 0, base = 0, ll = 0, llBase = 0;
    history.forEach(function (h, i) {
      var pr = params[h.type] || defaults(h.type);
      var y = h.passed ? 1 : 0;
      if (i >= cut) {
        var p = clip(predict(pL[h.type], pr));
        var pb = clip(seen ? seenOk / seen : 0.5);
        n++;
        if ((p >= 0.5 ? 1 : 0) === y) hit++;
        if ((pb >= 0.5 ? 1 : 0) === y) base++;
        ll -= y ? Math.log(p) : Math.log(1 - p);
        llBase -= y ? Math.log(pb) : Math.log(1 - pb);
      }
      pL[h.type] = update(pL[h.type], !!y, pr);
      seen++; seenOk += y;
    });
    return {
      n: n, accuracy: hit / n, baseline: base / n,
      logLoss: ll / n, baseLogLoss: llBase / n, trainN: cut
    };
  }

  return {
    defaults: defaults, predict: predict, update: update,
    fitAll: fitAll, trace: trace, evaluate: evaluate
  };
})();
