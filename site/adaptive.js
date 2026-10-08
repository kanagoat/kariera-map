/*
 * 2-кезең (v3.0) логикасы: қай сұрақтарды қою керек және нәтижені қайта есептеу.
 * Таза функциялар: браузерде де, Node-та да (tests/, tools/simulate.js) жұмыс істейді.
 * Ережелер — docs/adaptive-design.md. Шектер ADAPT ішінде.
 */
(function (root) {
  const S = typeof module !== "undefined" && module.exports ? require("./scoring.js") : root.Scoring;

  const ADAPT = {
    zone: 0.3, // шекараға осыдан жақын бағыт «шекаралық» (пилоттан кейін SEM-мен ауыстырылады)
    maxBorderline: 3,
    maxItems: 15,
  };

  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const nums = (ids, answers) => ids.map((id) => answers[id]).filter((v) => typeof v === "number");
  const stage1Ids = (Q, code) => Q.fields.find((f) => f.code === code).items.map((_, i) => code + (i + 1));

  // 1-кезеңнің жеке орташасы (дөңгелектелмеген)
  function personalMean(Q, answers) {
    return mean(Q.fields.flatMap((f) => nums(stage1Ids(Q, f.code), answers)));
  }

  // Шекаралық бағыттар: көшбасшыдан басқа, шекараға zone-нан жақын, екі жағынан да.
  function borderline(Q, s1, opts) {
    const o = Object.assign({}, ADAPT, opts);
    if (s1.uninformative) return [];
    const ranked = Q.fields
      .map((f) => ({ code: f.code, dev: s1.dev[f.code] }))
      .filter((x) => typeof x.dev === "number")
      .sort((a, b) => b.dev - a.dev);
    if (ranked.length < 2) return [];
    const cutoff = ranked[0].dev - S.THRESHOLDS.candidateWindow;
    return ranked
      .slice(1)
      .map((x) => ({ code: x.code, dist: Math.abs(x.dev - cutoff) }))
      .filter((x) => x.dist < o.zone)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, o.maxBorderline)
      .map((x) => x.code);
  }

  // 1-раунд: шекаралық бағыттардың нақтылау тұжырымдары + көшбасшының бір тұжырымын қайталау.
  function planRound1(Q, A, s1, opts) {
    const bl = borderline(Q, s1, opts);
    if (!bl.length) return { borderline: [], items: [], repeat: null };
    const leader = Q.fields
      .map((f) => f.code)
      .reduce((best, c) => (s1.dev[c] > s1.dev[best] ? c : best));
    const items = bl.flatMap((c) => A.deep[c].map((it) => ({ id: it.id, field: c, kind: "deep" })));
    return { borderline: bl, items, repeat: { id: leader + "1", field: leader } };
  }

  // Шекаралық бағыттардың жаңа балы: 4 + 3 тұжырымның орташасы минус 1-кезеңнің жеке орташасы.
  function rescore(Q, A, s1, answers, bl) {
    const pm = personalMean(Q, answers);
    const dev = Object.assign({}, s1.dev);
    bl.forEach((c) => {
      const vals = nums(stage1Ids(Q, c).concat(A.deep[c].map((it) => it.id)), answers);
      if (vals.length && pm !== null) dev[c] = Math.round((mean(vals) - pm) * 100) / 100;
    });
    return Object.assign({ dev, uninformative: s1.uninformative, personalMean: s1.personalMean }, S.selectCandidates(Q, dev));
  }

  // 2-раунд: көрсетілетін бағыттарда тармақ болса, тармақ тұжырымдары.
  // budget — 1-раундтан кейін қалған сұрақ саны; тармақ тек толық күйінде қойылады.
  function planForks(A, shown, budget) {
    let left = budget === undefined ? Infinity : budget;
    const out = [];
    Object.keys(A.forks)
      .filter((c) => shown.includes(c))
      .forEach((c) => {
        const items = Object.keys(A.forks[c].branches).flatMap((p) =>
          A.forks[c].branches[p].map((it) => ({ id: it.id, field: c, branch: p, kind: "fork" }))
        );
        if (items.length <= left) {
          out.push(...items);
          left -= items.length;
        }
      });
    return out;
  }

  // Тармақтар бойынша бағыттың жұптары: { GEO: ["BG"], BCH: ["BC","CP"] }
  function resolveForks(A, answers, shown) {
    const out = {};
    Object.keys(A.forks)
      .filter((c) => shown.includes(c))
      .forEach((c) => {
        const fk = A.forks[c];
        const m = {};
        Object.keys(fk.branches).forEach((p) => (m[p] = mean(nums(fk.branches[p].map((it) => it.id), answers))));
        const [p1, p2] = Object.keys(fk.branches);
        if (m[p1] === null || m[p2] === null) return;
        const diff = m[p1] - m[p2];
        if (fk.winnerOnly) {
          if (diff >= fk.margin) out[c] = [p1];
          else if (-diff >= fk.margin) out[c] = [p2];
        } else {
          // base әрқашан қалады; base-те жоқ тармақ айқын жоғары болса қосылады
          const extra = Object.keys(fk.branches).find((p) => !fk.base.includes(p));
          const other = Object.keys(fk.branches).find((p) => p !== extra);
          if (m[extra] - m[other] >= fk.margin) out[c] = fk.base.concat([extra]);
        }
      });
    return out;
  }

  // Q.fieldPairs-ке тармақ нәтижесін қосып, finalize үшін Q көшірмесі.
  function withForkPairs(Q, overrides) {
    return Object.assign({}, Q, { fieldPairs: Object.assign({}, Q.fieldPairs, overrides) });
  }

  // Қайталау: айырма 2 және одан көп болса — сәйкессіздік.
  function consistency(answers, repeat, repeatValue) {
    if (!repeat || typeof repeatValue !== "number" || typeof answers[repeat.id] !== "number") return null;
    return Math.abs(answers[repeat.id] - repeatValue);
  }

  // Іс жүзіндегі шарттар: оқушы алғашқы екі орынға қойған бағыттардың кең бағыттары.
  function planPractical(A, ranking) {
    const dirs = [];
    ranking.slice(0, 2).forEach((code) => {
      const d = Object.keys(A.directions).find((k) => A.directions[k].fields.includes(code));
      if (d && !dirs.includes(d)) dirs.push(d);
    });
    return dirs.flatMap((d) => A.practical[d].map((it) => ({ id: it.id, direction: d, kind: "practical" })));
  }

  const Adaptive = { ADAPT, borderline, planRound1, rescore, planForks, resolveForks, withForkPairs, consistency, planPractical, personalMean };
  if (typeof module !== "undefined" && module.exports) module.exports = Adaptive;
  else root.Adaptive = Adaptive;
})(typeof window !== "undefined" ? window : globalThis);
