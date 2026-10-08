/*
 * Есептеу ережелері (docs/scoring-rules.md құжатымен бірдей болуы керек).
 * Таза функциялар: браузерде де, Node-та да (tests/) жұмыс істейді.
 * Барлық шектік мәндер THRESHOLDS ішінде — пилоттан кейін осы жерден өзгертіледі.
 */
(function (root) {
  const THRESHOLDS = {
    candidateWindow: 0.8, // ең жоғары бағыттан осынша балға дейін қалатындар «мүмкін бағыт»
    maxCandidates: 4,
    minCandidates: 2, // реттеу қадамы үшін кемінде екеу көрсетіледі
    uninformativeHigh: 4.3, // жалпы орташа осыдан жоғары болса — «ақпаратсыз профиль»
    uninformativeLow: 2.0,
    straightline: 20, // қатарынан бірдей жауап саны
    minMedianMs: 3000, // бір тұжырымға медиана уақыт
    matrixHigh: 0.5,
    matrixLow: -0.5,
    pairFlag: -1.0, // жұп пәнінің «ұнайды» ауытқуы осыдан төмен болса, жұп белгіленеді
    anxietyFlag: 4.0,
  };

  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const round2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);
  const median = (arr) => {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  // answers: { ENG1: 1..5, ... } — 56 тұжырым
  function scoreInterests(Q, answers) {
    const all = [];
    const raw = {};
    Q.fields.forEach((f) => {
      const vals = f.items.map((_, i) => answers[f.code + (i + 1)]).filter((v) => typeof v === "number");
      raw[f.code] = mean(vals);
      all.push(...vals);
    });
    const personalMean = mean(all);
    const dev = {};
    Q.fields.forEach((f) => {
      dev[f.code] = raw[f.code] === null ? null : raw[f.code] - personalMean;
    });

    const uninformative =
      personalMean !== null &&
      (personalMean >= THRESHOLDS.uninformativeHigh || personalMean <= THRESHOLDS.uninformativeLow);

    const ranked = Q.fields
      .map((f) => ({ code: f.code, dev: dev[f.code] }))
      .filter((x) => x.dev !== null)
      .sort((a, b) => b.dev - a.dev);

    let within = [];
    if (ranked.length) {
      const top = ranked[0].dev;
      within = ranked.filter((x) => top - x.dev < THRESHOLDS.candidateWindow);
    }
    const wide = within.length > THRESHOLDS.maxCandidates;
    const strict = within.slice(0, THRESHOLDS.maxCandidates).map((x) => x.code);
    // реттеу үшін кемінде екі бағыт керек
    const shown = strict.slice();
    for (let i = 0; shown.length < THRESHOLDS.minCandidates && i < ranked.length; i++) {
      if (!shown.includes(ranked[i].code)) shown.push(ranked[i].code);
    }
    const rejected = ranked.filter((x) => x.dev <= -THRESHOLDS.candidateWindow).map((x) => x.code);

    return {
      personalMean: round2(personalMean),
      raw: mapValues(raw, round2),
      dev: mapValues(dev, round2),
      uninformative,
      wide,
      candidates: strict,
      shown,
      rejected,
    };
  }

  // sequence: көрсетілген рет [{id, kind, expected}], answers: {id: 1..5}, times: {id: ms}
  function scoreQuality(sequence, answers, times) {
    const attentionFailed = sequence
      .filter((s) => s.kind === "attention")
      .filter((s) => answers[s.id] !== s.expected)
      .map((s) => s.id);

    let longest = 0;
    let run = 0;
    let prev = null;
    sequence
      .filter((s) => s.kind === "item")
      .forEach((s) => {
        const v = answers[s.id];
        if (v === prev) run += 1;
        else run = 1;
        prev = v;
        if (run > longest) longest = run;
      });

    const ts = sequence.map((s) => times[s.id]).filter((t) => typeof t === "number" && t > 0);
    const medianMs = median(ts);
    const tooFast = medianMs !== null && medianMs < THRESHOLDS.minMedianMs;
    const straightlining = longest >= THRESHOLDS.straightline;

    const flags = [];
    if (attentionFailed.length) flags.push("attention");
    if (straightlining) flags.push("straightline");
    if (tooFast) flags.push("fast");

    return {
      attentionFailed,
      longestRun: longest,
      medianMs: medianMs === null ? null : Math.round(medianMs),
      flags,
      valid: flags.length === 0,
    };
  }

  // matrix: { math: {can:1..5|null, like:..., keep:...}, ... }; null = «оқымаймын»
  function scoreMatrix(Q, matrix) {
    const keys = Q.matrixRatings.map((r) => r.key);
    const means = {};
    keys.forEach((k) => {
      means[k] = mean(
        Q.subjects.map((s) => (matrix[s.key] ? matrix[s.key][k] : null)).filter((v) => typeof v === "number")
      );
    });
    const dev = {};
    const reading = {};
    Q.subjects.forEach((s) => {
      const row = matrix[s.key] || {};
      dev[s.key] = {};
      keys.forEach((k) => {
        dev[s.key][k] = typeof row[k] === "number" && means[k] !== null ? round2(row[k] - means[k]) : null;
      });
      reading[s.key] = readSubject(dev[s.key]);
    });
    return { means: mapValues(means, round2), dev, reading };
  }

  function readSubject(d) {
    if (d.like === null || d.can === null) return "missing";
    const hi = THRESHOLDS.matrixHigh;
    const lo = THRESHOLDS.matrixLow;
    if (d.like >= hi && d.can >= hi) return "like+can"; // тұрақты бейімділік белгісі
    if (d.like <= lo && d.keep !== null && d.keep >= hi) return "keep-not-like"; // пайда немесе сыртқы қысым
    if (d.like <= lo && d.can >= hi) return "can-not-like"; // қызығушылықсыз қабілет
    if (d.like >= hi && d.can <= lo) return "like-not-can"; // қызығушылық бар, сенім не дағды жетпейді
    return "neutral";
  }

  // anxiety: { MA1: 1..5, ... }
  function scoreAnxiety(Q, anxiety) {
    const group = (g) => mean(Q.anxiety.filter((a) => a.group === g).map((a) => anxiety[a.id]).filter((v) => typeof v === "number"));
    const math = group("math");
    const text = group("text");
    return {
      math: round2(math),
      text: round2(text),
      fearMath: math !== null && math >= THRESHOLDS.anxietyFlag,
      fearText: text !== null && text >= THRESHOLDS.anxietyFlag,
    };
  }

  // ranking: оқушы реттеген бағыт кодтары (қосқан бағытымен бірге)
  function finalize(Q, { interests, ranking, statedPair, matrix }) {
    const pairs = [];
    ranking.forEach((code) => {
      (Q.fieldPairs[code] || []).forEach((p) => {
        if (!pairs.includes(p)) pairs.push(p);
      });
    });

    const flaggedPairs = pairs.filter((p) =>
      Q.pairs[p].subjects.some((s) => {
        const d = matrix && matrix.dev[s] ? matrix.dev[s].like : null;
        return d !== null && d < THRESHOLDS.pairFlag;
      })
    );

    const contradictsStated = !!statedPair && statedPair !== "none" && !pairs.includes(statedPair);

    const reasons = [];
    if (interests.uninformative) reasons.push("uninformative");
    if (interests.wide) reasons.push("wide");
    if (pairs.length > 2) reasons.push("many-pairs");
    if (contradictsStated) reasons.push("stated-differs");
    if (flaggedPairs.length) reasons.push("pair-disliked");

    return {
      pairs,
      flaggedPairs,
      contradictsStated,
      status: reasons.length ? "open" : "emerging", // «бағыт әлі ашық» / «бағыт айқындалып келеді»
      reasons,
    };
  }

  function mapValues(obj, fn) {
    const out = {};
    Object.keys(obj).forEach((k) => (out[k] = fn(obj[k])));
    return out;
  }

  const Scoring = { THRESHOLDS, scoreInterests, scoreQuality, scoreMatrix, scoreAnxiety, finalize, readSubject };
  if (typeof module !== "undefined" && module.exports) module.exports = Scoring;
  else root.Scoring = Scoring;
})(typeof window !== "undefined" ? window : globalThis);
