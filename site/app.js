/*
 * Сауалнама логикасы: қадамдар, жауаптарды сақтау, нәтижені есептеу және жіберу.
 * Мазмұн — data/questionnaire.js, интерфейс мәтіні — i18n.js, есептеу — scoring.js, баптау — config.js.
 */
(function () {
  "use strict";

  const Q = window.Q;
  const S = window.Scoring;
  const I18N = window.I18N;
  const CFG = window.APP_CONFIG || {};
  const STORE_KEY = "kk_map_v2";
  const LANG_KEY = "kk_map_lang";
  const DEVICE_KEY = "kk_map_device";
  const app = document.getElementById("app");
  const trail = document.getElementById("trail");
  const langSwitch = document.getElementById("lang");
  const brand = document.getElementById("brand");

  const SEQUENCE = Q.buildInterestSequence();
  const FIELD = Object.fromEntries(Q.fields.map((f) => [f.code, f]));
  const STEP_STAGE = { code: 0, about: 0, intake: 0, interests: 1, ranking: 2, subjects: 3, feelings: 3, send: 4, done: 4 };
  const REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const params = new URLSearchParams(location.search);
  const cohort = params.get("c") || CFG.cohort || "";
  const urlCode = params.get("k") || "";
  const needCode = !!(CFG.requireCode && CFG.endpoint);
  const MAX_SKIPPED = 4; // «оқымаймын» белгісі ең көбі осынша пәнге
  const normCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  // Құрылғының кездейсоқ белгісі: код осы құрылғыға байланады (жеке дерек емес).
  let deviceMem = "";
  function deviceId() {
    try {
      let d = localStorage.getItem(DEVICE_KEY);
      if (!d) {
        d = newId() + newId();
        localStorage.setItem(DEVICE_KEY, d);
      }
      return d;
    } catch (e) {
      return deviceMem || (deviceMem = newId() + newId());
    }
  }

  // ---------- тіл ----------
  let lang = pickLang();
  let T = I18N[lang];

  function pickLang() {
    const fromUrl = params.get("lang");
    if (fromUrl && I18N[fromUrl]) return fromUrl;
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved && I18N[saved]) return saved;
    } catch (e) {}
    return "kk";
  }
  function setLang(l) {
    if (!I18N[l] || l === lang) return;
    lang = l;
    T = I18N[lang];
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch (e) {}
    applyChrome();
    enter = "fade";
    render();
  }
  function applyChrome() {
    document.documentElement.lang = lang;
    document.title = T.brand;
    brand.textContent = T.brand;
    trail.setAttribute("aria-label", T.trailLabel);
    langSwitch.setAttribute("aria-label", T.langLabel);
    langSwitch.innerHTML = Object.keys(I18N)
      .map((l) => `<button type="button" data-lang="${l}" aria-pressed="${l === lang}" class="${l === lang ? "on" : ""}">${I18N[l].langName}</button>`)
      .join("");
  }
  langSwitch.addEventListener("click", (e) => {
    const b = e.target.closest("[data-lang]");
    if (b) setLang(b.dataset.lang);
  });

  // Мазмұнды таңдалған тілде алу. Деректерге (Sheets) әрқашан қазақша нұсқа жазылады.
  const ru = () => lang === "ru";
  const fieldName = (c) => (ru() ? Q.ru.fields[c].name : FIELD[c].name);
  const fieldBlurb = (c) => (ru() ? Q.ru.fields[c].blurb : FIELD[c].blurb);
  const pairLabel = (p) => (ru() ? Q.ru.pairs[p] : Q.pairs[p].name);
  const subjectName = (s) => (ru() ? Q.ru.subjects[s.key] : s.name);
  const rating = (r) => (ru() ? Q.ru.matrixRatings[r.key] : r);
  const anxietyText = (a) => (ru() ? Q.ru.anxiety[a.id] : a.text);
  const openText = (o) => (ru() ? Q.ru.open[o.id] : o.text);
  const interestScale = () => (ru() ? Q.ru.interestScale : Q.interestScale);
  const agreeScale = () => (ru() ? Q.ru.agreeScale : Q.agreeScale);
  function itemText(item) {
    if (!ru()) return item.text;
    if (item.kind === "attention") return Q.ru.attention[item.id];
    return Q.ru.fields[item.field].items[Number(item.id.slice(-1)) - 1];
  }

  // ---------- күй ----------
  const fresh = () => ({
    step: "welcome",
    submissionId: newId(),
    startedAt: Date.now(),
    access: { code: "", ok: false, cohort: "" },
    student: { name: "", grade: "", after9: "", consent: false },
    intake: { plan: "", planUnknown: false, confidence: 50, statedPair: "", teacher: "", teacherSubject: "", sportArt: "", grant: "" },
    idx: 0,
    answers: {},
    times: {},
    ranking: [],
    added: "",
    matrix: {},
    anxiety: {},
    open: {},
    sent: false,
  });

  let state = load() || fresh();
  if (!state.access) state.access = { code: "", ok: false, cohort: "" };
  let afterCode = null;
  // бет қайта ашылғанда алдымен сәлемдесу беті шығады, «Жалғастыру» сақталған қадамға апарады
  let resumeStep = state.step !== "welcome" ? state.step : null;
  state.step = "welcome";
  let itemShownAt = 0;
  let locked = false;
  // келесі сызбада қандай кіру анимациясы болады: "fade" | "fwd" | "back" | null
  let enter = "fade";
  let barFrom = 0;

  function newId() {
    const rnd = Math.random().toString(36).slice(2, 8);
    return Date.now().toString(36) + "-" + rnd;
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return s && s.step && !s.sent ? s : null;
    } catch (e) {
      return null;
    }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      /* жеке режимде сақталмауы мүмкін — сауалнама бәрібір жұмыс істейді */
    }
  }
  function clearStore() {
    try {
      localStorage.removeItem(STORE_KEY);
    } catch (e) {}
  }

  // ---------- көмекші ----------
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Кіру анимациясының класы: тек жаңа қадамға өткенде, бір рет.
  function enterCls() {
    const cls = enter ? " enter enter-" + enter : "";
    enter = null;
    return cls;
  }

  function go(step) {
    const before = STEP_ORDER.indexOf(state.step);
    state.step = step;
    enter = STEP_ORDER.indexOf(step) < before ? "back" : "fwd";
    save();
    render();
    window.scrollTo({ top: 0, behavior: REDUCED ? "auto" : "smooth" });
    const h = app.querySelector("h1, h2");
    if (h) {
      h.setAttribute("tabindex", "-1");
      h.focus({ preventScroll: true });
    }
  }
  const STEP_ORDER = ["welcome", "code", "about", "intake", "interests", "ranking", "subjects", "feelings", "send", "done"];

  function renderTrail() {
    const stage = STEP_STAGE[state.step];
    trail.hidden = stage === undefined;
    if (stage === undefined) return;
    trail.innerHTML = T.stages
      .map((name, i) => {
        const cls = i < stage ? "done" : i === stage ? "now" : "";
        const cur = i === stage ? ' aria-current="step"' : "";
        return `<li class="${cls}"${cur}><span class="dot"></span><span class="lbl">${name}</span></li>`;
      })
      .join("");
  }

  function render() {
    renderTrail();
    const views = { welcome, code, about, intake, interests, ranking, subjects, feelings, send, done };
    (views[state.step] || welcome)();
  }

  function scaleButtons(name, value, labels, compact) {
    return `<div class="scale ${compact ? "scale-compact" : ""}" role="radiogroup" data-name="${name}">
      ${[1, 2, 3, 4, 5]
        .map(
          (n) => `<button type="button" role="radio" aria-checked="${value === n}" class="pick ${value === n ? "on" : ""}" data-val="${n}" aria-label="${n} — ${esc(labels[n - 1])}" style="--i:${n}">
            <span class="num">${n}</span>${compact ? "" : `<span class="txt">${esc(labels[n - 1])}</span>`}
          </button>`
        )
        .join("")}
    </div>`;
  }

  function choice(name, value, options) {
    return `<div class="choices" role="radiogroup" data-choice="${name}">
      ${options
        .map(
          (o) =>
            `<button type="button" role="radio" aria-checked="${value === o.v}" class="chip ${value === o.v ? "on" : ""}" data-val="${esc(o.v)}">${esc(o.t)}</button>`
        )
        .join("")}
    </div>`;
  }

  // Чиптерді бетті қайта салмай ауыстыру: енгізілген мәтін мен анимация сақталады.
  function setChip(chip) {
    chip.parentNode.querySelectorAll(".chip").forEach((c) => {
      const on = c === chip;
      c.classList.toggle("on", on);
      c.setAttribute("aria-checked", on);
    });
  }

  function markPick(group, val) {
    group.querySelectorAll(".pick").forEach((b) => {
      const on = Number(b.dataset.val) === val;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on);
    });
  }

  function showError(msg) {
    let el = app.querySelector(".error");
    if (!el) {
      el = document.createElement("p");
      el.className = "error";
      el.setAttribute("role", "alert");
      const actions = app.querySelector(".actions");
      actions.parentNode.insertBefore(el, actions);
    }
    el.textContent = msg;
    el.classList.remove("shake");
    void el.offsetWidth; // анимацияны қайта іске қосу
    el.classList.add("shake");
    el.scrollIntoView({ block: "center", behavior: REDUCED ? "auto" : "smooth" });
  }

  function toast(msg) {
    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("out"), 1700);
    setTimeout(() => el.remove(), 2200);
  }

  // ---------- 0. Сәлемдесу ----------
  function welcome() {
    const resumed = !!resumeStep;
    app.innerHTML = `
      <section class="hero${enterCls()}">
        <svg class="ridge" viewBox="0 0 640 260" aria-hidden="true" focusable="false">
          <g class="clouds"><ellipse class="cloud c1" cx="120" cy="52" rx="46" ry="12"/><ellipse class="cloud c2" cx="470" cy="38" rx="60" ry="14"/></g>
          <circle class="sun" cx="540" cy="70" r="26"/>
          <path class="far" d="M0 210 L90 120 L150 165 L250 60 L330 150 L400 105 L500 190 L560 150 L640 205 L640 260 L0 260Z"/>
          <path class="near" d="M0 240 L120 170 L200 215 L330 110 L430 200 L520 160 L640 235 L640 260 L0 260Z"/>
          <path class="route" d="M30 246 C110 236 150 214 196 212 S270 168 300 138 S322 118 330 110"/>
          <circle class="wp w1" cx="30" cy="246" r="6"/><circle class="wp w2" cx="196" cy="212" r="6"/><circle class="wp w3" cx="286" cy="152" r="6"/>
          <path class="flag" d="M330 110 V78 L356 88 L330 98"/>
        </svg>
        <h1>${T.welcomeTitle}</h1>
        <p class="lead">${T.welcomeLead}</p>
        <ul class="facts">
          ${T.facts.map((f, i) => `<li style="--i:${i}">${f}</li>`).join("")}
        </ul>
        <div class="actions">
          <button class="btn primary" data-act="start">${resumed ? T.resume : T.start}</button>
          ${resumed ? `<button class="btn ghost" data-act="reset">${T.reset}</button>` : ""}
        </div>
        ${CFG.endpoint ? "" : `<p class="demo">${T.demo}</p>`}
      </section>`;
    app.oninput = null;
    app.onclick = (e) => {
      const act = e.target.closest("[data-act]");
      if (!act) return;
      if (act.dataset.act === "reset") {
        clearStore();
        state = fresh();
        resumeStep = null;
      }
      const target = resumeStep || "about";
      if (needCode && !state.access.ok) {
        afterCode = target === "code" ? "about" : target;
        return go("code");
      }
      go(target);
    };
  }

  // ---------- 0а. Кіру коды ----------
  function code() {
    const a = state.access;
    if (!a.code && urlCode) a.code = normCode(urlCode);
    app.innerHTML = `
      <section class="card${enterCls()}">
        <h2>${T.codeTitle}</h2>
        <p class="hint">${T.codeHint}</p>
        <label class="field">${T.codeLabel}
          <input type="text" id="code" class="code-input" value="${esc(a.code)}" placeholder="${esc(T.codePh)}"
            autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" />
        </label>
        <div class="actions">
          <button class="btn ghost" data-act="back">${T.back}</button>
          <button class="btn primary" data-act="check">${T.codeCheck}</button>
        </div>
      </section>`;
    const input = app.querySelector("#code");
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") checkCode();
    });
    app.oninput = () => {
      a.code = input.value;
      save();
    };
    app.onclick = (e) => {
      if (e.target.closest("[data-act=back]")) return go("welcome");
      if (e.target.closest("[data-act=check]")) checkCode();
    };
  }

  const codeErrors = () => ({
    not_found: T.errCodeNotFound,
    code_invalid: T.errCodeNotFound,
    used: T.errCodeUsed,
    code_used: T.errCodeUsed,
    other_device: T.errCodeOther,
    code_other_device: T.errCodeOther,
  });

  function checkCode() {
    const a = state.access;
    const c = normCode(a.code);
    if (!c) return showError(T.errCodeEmpty);
    const btn = app.querySelector("[data-act=check]");
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = T.codeChecking;
    const reset = () => {
      btn.disabled = false;
      btn.textContent = T.codeCheck;
    };
    fetch(CFG.endpoint + "?action=check&code=" + encodeURIComponent(c) + "&device=" + encodeURIComponent(deviceId()))
      .then((res) => res.json())
      .then((d) => {
        if (!d || !d.ok) throw new Error("server");
        if (!d.valid) {
          reset();
          return showError(codeErrors()[d.reason] || T.errCodeNotFound);
        }
        a.code = c;
        a.ok = true;
        a.cohort = d.cohort || "";
        save();
        go(afterCode || "about");
      })
      .catch(() => {
        reset();
        showError(T.errCodeNet);
      });
  }

  // ---------- 1. Танысу ----------
  function about() {
    const st = state.student;
    app.innerHTML = `
      <section class="card${enterCls()}">
        <h2>${T.aboutTitle}</h2>
        <label class="field">${T.name}
          <input type="text" id="name" autocomplete="name" value="${esc(st.name)}" placeholder="${esc(T.namePh)}" />
        </label>
        <div class="field">${T.grade}
          ${choice("grade", st.grade, ["9", "10", "11"].map((n) => ({ v: n, t: T.gradeOpt(n) })))}
        </div>
        <div class="field reveal" id="after9wrap" ${st.grade === "9" ? "" : "hidden"}>${T.after9}
          ${choice("after9", st.after9, [
            { v: "school", t: T.after9School },
            { v: "college", t: T.after9College },
            { v: "unsure", t: T.after9Unsure },
          ])}
        </div>
        <label class="check">
          <input type="checkbox" id="consent" ${st.consent ? "checked" : ""} />
          <span>${T.consent}</span>
        </label>
        <div class="actions"><button class="btn primary" data-act="next">${T.next}</button></div>
      </section>`;
    app.oninput = () => {
      st.name = app.querySelector("#name").value;
      st.consent = app.querySelector("#consent").checked;
      save();
    };
    app.onclick = (e) => {
      const chip = e.target.closest(".chip");
      if (chip) {
        const name = chip.parentNode.dataset.choice;
        st[name] = chip.dataset.val;
        setChip(chip);
        if (name === "grade") {
          if (st.grade !== "9") {
            st.after9 = "";
            app.querySelectorAll("#after9wrap .chip").forEach((c) => c.classList.remove("on"));
          }
          app.querySelector("#after9wrap").hidden = st.grade !== "9";
        }
        save();
        return;
      }
      if (e.target.closest("[data-act=next]")) {
        if (!st.name.trim()) return showError(T.errName);
        if (!st.grade) return showError(T.errGrade);
        if (st.grade === "9" && !st.after9) return showError(T.errAfter9);
        if (!st.consent) return showError(T.errConsent);
        go("intake");
      }
    };
  }

  // ---------- 2. Кіріспе сұрақтар ----------
  function intake() {
    const it = state.intake;
    const pairOptions = [{ v: "none", t: T.pairNone }].concat(Object.keys(Q.pairs).map((k) => ({ v: k, t: pairLabel(k) })));
    const ynm = [{ v: "yes", t: T.yes }, { v: "maybe", t: T.maybe }, { v: "no", t: T.no }];
    app.innerHTML = `
      <section class="card${enterCls()}">
        <h2>${T.intakeTitle}</h2>
        <label class="field">${T.plan}
          <input type="text" id="plan" value="${esc(it.plan)}" placeholder="${esc(T.planPh)}" />
        </label>
        <label class="field">${T.conf} <output id="confOut">${it.confidence}%</output>
          <input type="range" id="confidence" min="0" max="100" step="10" value="${it.confidence}" style="--p:${it.confidence}%" />
          <span class="range-ends"><span>${T.confLo}</span><span>${T.confHi}</span></span>
        </label>
        <div class="field">${T.pair}
          ${choice("statedPair", it.statedPair, pairOptions)}
        </div>
        <div class="field">${T.teacher}
          ${choice("teacher", it.teacher, ynm)}
        </div>
        <label class="field reveal" id="tsWrap" ${it.teacher === "yes" || it.teacher === "maybe" ? "" : "hidden"}>${T.teacherSubject}
          <input type="text" id="teacherSubject" value="${esc(it.teacherSubject)}" />
        </label>
        <div class="field">${T.sportArt}
          ${choice("sportArt", it.sportArt, ynm)}
        </div>
        <div class="field">${T.grant}
          ${choice("grant", it.grant, [
            { v: "must", t: T.grantMust },
            { v: "prefer", t: T.grantPrefer },
            { v: "any", t: T.grantAny },
          ])}
        </div>
        <div class="actions">
          <button class="btn ghost" data-act="back">${T.back}</button>
          <button class="btn primary" data-act="next">${T.next}</button>
        </div>
      </section>`;
    app.oninput = () => {
      it.plan = app.querySelector("#plan").value;
      const range = app.querySelector("#confidence");
      it.confidence = Number(range.value);
      range.style.setProperty("--p", it.confidence + "%");
      const out = app.querySelector("#confOut");
      out.textContent = it.confidence + "%";
      out.classList.remove("bump");
      void out.offsetWidth;
      out.classList.add("bump");
      it.teacherSubject = app.querySelector("#teacherSubject").value;
      save();
    };
    app.onclick = (e) => {
      const chip = e.target.closest(".chip");
      if (chip) {
        const name = chip.parentNode.dataset.choice;
        it[name] = chip.dataset.val;
        setChip(chip);
        if (name === "teacher") app.querySelector("#tsWrap").hidden = !(it.teacher === "yes" || it.teacher === "maybe");
        save();
        return;
      }
      if (e.target.closest("[data-act=back]")) return go("about");
      if (e.target.closest("[data-act=next]")) {
        if (!it.statedPair) return showError(T.errPair);
        if (!it.teacher || !it.sportArt || !it.grant) return showError(T.errAll);
        go("interests");
      }
    };
  }

  // ---------- 3. Қызығушылық: бір тұжырым — бір экран ----------
  function interests() {
    const total = SEQUENCE.length;
    if (state.idx >= total) return go("ranking");
    const item = SEQUENCE[state.idx];
    const value = state.answers[item.id];
    const first = state.idx === 0 && value === undefined;
    const pct = Math.round((state.idx / total) * 100);
    app.innerHTML = `
      <section class="card ask${enterCls()}">
        <div class="count"><span>${state.idx + 1} / ${total}</span>
          <span class="bar"><span style="width:${barFrom}%"></span></span></div>
        ${first ? `<p class="hint">${T.interestsHint}</p>` : ""}
        <h2 class="statement">${esc(itemText(item))}</h2>
        ${scaleButtons("interest", value, interestScale(), false)}
        <div class="actions">
          ${state.idx > 0 ? `<button class="btn ghost" data-act="back">${T.prev}</button>` : `<button class="btn ghost" data-act="exit">${T.back}</button>`}
          ${value !== undefined ? `<button class="btn primary" data-act="fwd">${T.fwd}</button>` : ""}
        </div>
      </section>`;
    // прогресс жолағы алдыңғы орнынан жаңасына жылжиды
    const fill = app.querySelector(".bar span");
    requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = pct + "%")));
    barFrom = pct;
    itemShownAt = performance.now();
    locked = false;
    app.oninput = null;
    app.onclick = (e) => {
      const pick = e.target.closest(".pick");
      if (pick) return answer(item, Number(pick.dataset.val));
      if (e.target.closest("[data-act=back]")) {
        state.idx -= 1;
        enter = "back";
        save();
        return interests();
      }
      if (e.target.closest("[data-act=exit]")) return go("intake");
      if (e.target.closest("[data-act=fwd]")) {
        state.idx += 1;
        enter = "fwd";
        save();
        return interests();
      }
    };
  }

  function answer(item, val) {
    if (locked) return;
    locked = true;
    const elapsed = Math.round(performance.now() - itemShownAt);
    // уақыт тек бірінші жауапта жазылады: қайта қарағанда бұзылмайды
    const firstTime = state.times[item.id] === undefined;
    if (firstTime) state.times[item.id] = elapsed;
    state.answers[item.id] = val;
    markPick(app.querySelector(".scale"), val);
    state.idx += 1;
    save();
    if (firstTime) {
      const before = Math.floor(((state.idx - 1) / SEQUENCE.length) * 4);
      const after = Math.floor((state.idx / SEQUENCE.length) * 4);
      if (after > before && after < 4) toast(T.milestones[after * 25]);
    }
    setTimeout(() => {
      enter = "fwd";
      interests();
    }, REDUCED ? 120 : 260);
  }

  document.addEventListener("keydown", (e) => {
    if (state.step !== "interests" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key >= "1" && e.key <= "5" && state.idx < SEQUENCE.length) answer(SEQUENCE[state.idx], Number(e.key));
  });

  // ---------- 4. Бағыттарды реттеу ----------
  function interestScores() {
    return S.scoreInterests(Q, state.answers);
  }

  function ranking() {
    const sc = interestScores();
    const free = sc.uninformative; // жауаптар бәрі бірдей дерлік — оқушы толық тізімнен өзі таңдайды
    const pool = free ? Q.fields.map((f) => f.code) : sc.shown;
    state.ranking = state.ranking.filter((c) => pool.includes(c));
    const maxPick = free ? 4 : pool.length;
    const rest = Q.fields.map((f) => f.code).filter((c) => !pool.includes(c));
    if (state.added && !rest.includes(state.added)) state.added = "";

    app.innerHTML = `
      <section class="card${enterCls()}">
        <h2>${free ? T.rankTitleFree : T.rankTitle}</h2>
        <p class="hint">${free ? T.rankHintFree : T.rankHint}</p>
        <ol class="rank" id="rank">
          ${pool
            .map(
              (code, i) => `<li style="--i:${i}"><button type="button" class="rank-item" data-code="${code}" aria-pressed="false">
                <span class="place"></span>
                <span><span class="rank-name">${esc(fieldName(code))}</span><span class="rank-blurb">${esc(fieldBlurb(code))}</span></span>
              </button></li>`
            )
            .join("")}
        </ol>
        ${
          free
            ? ""
            : `<label class="field">${T.added} <span class="opt">${T.optional}</span>
          <select id="added">
            <option value="">${T.addedNone}</option>
            ${rest.map((c) => `<option value="${c}" ${state.added === c ? "selected" : ""}>${esc(fieldName(c))}</option>`).join("")}
          </select>
        </label>`
        }
        <div class="actions">
          <button class="btn ghost" data-act="back">${T.back}</button>
          <button class="btn primary" data-act="next">${T.next}</button>
        </div>
      </section>`;
    paintRanking(null);
    app.oninput = (e) => {
      if (e.target.id === "added") {
        state.added = e.target.value;
        save();
      }
    };
    app.onclick = (e) => {
      const item = e.target.closest(".rank-item");
      if (item) {
        const code = item.dataset.code;
        const pos = state.ranking.indexOf(code);
        if (pos >= 0) state.ranking.splice(pos, 1);
        else if (state.ranking.length < maxPick) state.ranking.push(code);
        save();
        return paintRanking(pos >= 0 ? null : code);
      }
      if (e.target.closest("[data-act=back]")) {
        state.idx = SEQUENCE.length - 1;
        barFrom = Math.round((state.idx / SEQUENCE.length) * 100);
        return go("interests");
      }
      if (e.target.closest("[data-act=next]")) {
        const need = free ? 2 : pool.length;
        if (state.ranking.length < need) return showError(free ? T.errRankFree : T.errRank);
        go("subjects");
      }
    };
  }

  // Нөмірлерді орнында жаңарту; жаңа басылғаны «секіреді».
  function paintRanking(justAdded) {
    app.querySelectorAll(".rank-item").forEach((b) => {
      const pos = state.ranking.indexOf(b.dataset.code);
      b.classList.toggle("on", pos >= 0);
      b.setAttribute("aria-pressed", pos >= 0);
      b.querySelector(".place").textContent = pos >= 0 ? pos + 1 : "";
      b.classList.toggle("pop", b.dataset.code === justAdded);
    });
  }

  // ---------- 5. Пәндер матрицасы ----------
  function subjectComplete(key) {
    const row = state.matrix[key] || {};
    return row.skip === true || Q.matrixRatings.every((r) => typeof row[r.key] === "number");
  }

  function subjects() {
    const m = state.matrix;
    app.innerHTML = `
      <section class="card${enterCls()}">
        <h2>${T.subjectsTitle}</h2>
        <p class="hint">${T.subjectsHint}</p>
        <dl class="legend">
          ${Q.matrixRatings.map((r) => `<div><dt>${esc(rating(r).short)}</dt><dd>${esc(rating(r).text)}</dd></div>`).join("")}
        </dl>
        ${Q.subjects.map((s) => subjectBlock(s, m[s.key] || {})).join("")}
        <div class="actions">
          <button class="btn ghost" data-act="back">${T.back}</button>
          <button class="btn primary" data-act="next">${T.next}</button>
        </div>
      </section>`;
    app.oninput = (e) => {
      if (!e.target.classList.contains("skip")) return;
      const box = e.target.closest(".subject");
      const key = box.dataset.subject;
      m[key] = e.target.checked ? { skip: true } : {};
      save();
      const s = Q.subjects.find((x) => x.key === key);
      box.outerHTML = subjectBlock(s, m[key]);
    };
    app.onclick = (e) => {
      const pick = e.target.closest(".pick");
      if (pick) {
        const box = pick.closest(".subject");
        const key = box.dataset.subject;
        const group = pick.parentNode;
        m[key] = m[key] || {};
        m[key][group.dataset.name] = Number(pick.dataset.val);
        markPick(group, Number(pick.dataset.val));
        box.classList.toggle("complete", subjectComplete(key));
        save();
        return;
      }
      if (e.target.closest("[data-act=back]")) return go("ranking");
      if (e.target.closest("[data-act=next]")) {
        const skipped = Q.subjects.filter((s) => (m[s.key] || {}).skip === true).length;
        if (skipped > MAX_SKIPPED) return showError(T.errTooManySkipped(MAX_SKIPPED));
        const missing = Q.subjects.find((s) => !subjectComplete(s.key));
        if (missing) {
          showError(T.errSubject(subjectName(missing)));
          app.querySelector(`[data-subject=${missing.key}]`).scrollIntoView({ block: "center", behavior: REDUCED ? "auto" : "smooth" });
          return;
        }
        go("feelings");
      }
    };
  }

  function subjectBlock(s, row) {
    const skip = row.skip === true;
    return `<fieldset class="subject ${skip ? "skipped" : ""} ${subjectComplete(s.key) ? "complete" : ""}" data-subject="${s.key}">
      <legend>${esc(subjectName(s))}<span class="tick" aria-hidden="true">✓</span></legend>
      <label class="check small"><input type="checkbox" class="skip" ${skip ? "checked" : ""} /><span>${T.skip}</span></label>
      ${
        skip
          ? ""
          : Q.matrixRatings
              .map((r) => `<div class="mrow"><span class="mlabel">${esc(rating(r).short)}</span>${scaleButtons(r.key, row[r.key], agreeScale(), true)}</div>`)
              .join("")
      }
    </fieldset>`;
  }

  // ---------- 6. Алаңдау және ашық сұрақтар ----------
  function feelings() {
    app.innerHTML = `
      <section class="card${enterCls()}">
        <h2>${T.feelingsTitle}</h2>
        <p class="hint">${T.feelingsHint}</p>
        ${Q.anxiety
          .map(
            (a) =>
              `<div class="feel ${typeof state.anxiety[a.id] === "number" ? "complete" : ""}" data-id="${a.id}"><p>${esc(anxietyText(a))}</p>${scaleButtons(a.id, state.anxiety[a.id], agreeScale(), true)}</div>`
          )
          .join("")}
        ${Q.open
          .map(
            (o) => `<label class="field">${esc(openText(o))} <span class="opt">${T.optional}</span>
              <textarea rows="3" data-open="${o.id}">${esc(state.open[o.id] || "")}</textarea></label>`
          )
          .join("")}
        <div class="actions">
          <button class="btn ghost" data-act="back">${T.back}</button>
          <button class="btn primary" data-act="next">${T.sendBtn}</button>
        </div>
      </section>`;
    app.oninput = (e) => {
      if (e.target.dataset.open) {
        state.open[e.target.dataset.open] = e.target.value;
        save();
      }
    };
    app.onclick = (e) => {
      const pick = e.target.closest(".pick");
      if (pick) {
        const group = pick.parentNode;
        state.anxiety[group.dataset.name] = Number(pick.dataset.val);
        markPick(group, Number(pick.dataset.val));
        group.closest(".feel").classList.add("complete");
        save();
        return;
      }
      if (e.target.closest("[data-act=back]")) return go("subjects");
      if (e.target.closest("[data-act=next]")) {
        const missing = Q.anxiety.find((a) => typeof state.anxiety[a.id] !== "number");
        if (missing) {
          showError(T.errFeel);
          app.querySelector(`[data-id=${missing.id}]`).scrollIntoView({ block: "center", behavior: REDUCED ? "auto" : "smooth" });
          return;
        }
        go("send");
      }
    };
  }

  // ---------- 7. Жинақтау және жіберу ----------
  function buildPayload() {
    const interestsScore = interestScores();
    const quality = S.scoreQuality(SEQUENCE, state.answers, state.times);
    const matrixClean = {};
    Q.subjects.forEach((s) => {
      const row = state.matrix[s.key] || {};
      matrixClean[s.key] = row.skip ? null : row;
    });
    const matrixScore = S.scoreMatrix(Q, matrixClean);
    const anx = S.scoreAnxiety(Q, state.anxiety);
    const fullRanking = state.ranking.concat(state.added ? [state.added] : []);
    const fin = S.finalize(Q, {
      interests: interestsScore,
      ranking: fullRanking,
      statedPair: state.intake.statedPair,
      matrix: matrixScore,
    });
    // Sheets-ке әрқашан қазақша атаулар: тілге қарамай бағандар бірдей оқылады
    const pairName = (p) => (Q.pairs[p] ? Q.pairs[p].name : "");
    const fieldNameKk = (c) => (FIELD[c] ? FIELD[c].name : "");
    const now = new Date();

    const r = {
      submission_id: state.submissionId,
      submitted_at: now.toISOString(),
      cohort: state.access.cohort || cohort,
      access_code: state.access.ok ? state.access.code : "",
      access_device: state.access.ok ? deviceId() : "",
      version: CFG.version || "",
      lang,
      name: state.student.name.trim(),
      grade: state.student.grade,
      after9: state.student.after9,
      plan: state.intake.plan.trim(),
      confidence: state.intake.confidence,
      stated_pair: state.intake.statedPair === "none" ? "" : pairName(state.intake.statedPair),
      teacher: state.intake.teacher,
      teacher_subject: state.intake.teacherSubject.trim(),
      sport_art: state.intake.sportArt,
      grant: state.intake.grant,
      consent: state.student.consent,
    };
    Q.fields.forEach((f) => f.items.forEach((_, i) => (r[f.code + (i + 1)] = state.answers[f.code + (i + 1)])));
    Q.attention.forEach((a) => (r[a.id] = state.answers[a.id]));
    for (let i = 0; i < 4; i++) r["rank_" + (i + 1)] = state.ranking[i] || "";
    r.added_field = state.added || "";
    Q.subjects.forEach((s) =>
      Q.matrixRatings.forEach((m) => {
        const row = matrixClean[s.key];
        r[m.key + "_" + s.key] = row ? row[m.key] : "";
      })
    );
    Q.anxiety.forEach((a) => (r[a.id] = state.anxiety[a.id]));
    Q.open.forEach((o) => (r["open_" + o.id] = (state.open[o.id] || "").trim()));
    r.duration_sec = Math.round((Date.now() - state.startedAt) / 1000);
    r.interest_median_ms = quality.medianMs;
    r.user_agent = navigator.userAgent.slice(0, 160);

    const s = {
      submission_id: state.submissionId,
      submitted_at: now.toISOString(),
      cohort: r.cohort,
      access_code: r.access_code,
      lang,
      name: r.name,
      grade: r.grade,
      status: fin.status === "emerging" ? "бағыт айқындалып келеді" : "бағыт әлі ашық",
      reasons: fin.reasons.join(", "),
      pairs: fin.pairs.map(pairName).join("; "),
      ranking: fullRanking.map(fieldNameKk).join("; "),
      candidates: interestsScore.candidates.map(fieldNameKk).join("; "),
      rejected: interestsScore.rejected.map(fieldNameKk).join("; "),
      stated_pair: r.stated_pair,
      contradicts_stated: fin.contradictsStated,
      flagged_pairs: fin.flaggedPairs.map(pairName).join("; "),
      quality_valid: quality.valid,
      quality_flags: quality.flags.join(", "),
      attention_failed: quality.attentionFailed.join(", "),
      longest_run: quality.longestRun,
      median_ms: quality.medianMs,
      personal_mean: interestsScore.personalMean,
      spread: interestsScore.spread,
      uninformative: interestsScore.uninformative,
      wide: interestsScore.wide,
    };
    Q.fields.forEach((f) => (s["dev_" + f.code] = interestsScore.dev[f.code]));
    s.anxiety_math = anx.math;
    s.anxiety_text = anx.text;
    s.fear_math = anx.fearMath;
    s.fear_text = anx.fearText;
    Q.subjects.forEach((sub) => {
      s["read_" + sub.key] = matrixScore.reading[sub.key];
      s["like_dev_" + sub.key] = matrixScore.dev[sub.key].like;
    });
    s.matrix_skipped = Q.subjects.filter((sub) => matrixClean[sub.key] === null).length;
    s.teacher = r.teacher;
    s.sport_art = r.sport_art;
    s.after9 = r.after9;

    return { responses: r, scores: s, view: { interestsScore, fin, quality } };
  }

  let lastPayload = null;

  function send() {
    lastPayload = buildPayload();
    app.innerHTML = `<section class="card center${enterCls()}"><h2>${T.sending}</h2><p class="hint">${T.dontClose}</p><div class="spinner" aria-hidden="true"></div></section>`;
    app.onclick = null;
    app.oninput = null;
    if (!CFG.endpoint) {
      state.sent = true;
      clearStore();
      state.step = "done";
      enter = "fwd";
      return setTimeout(render, REDUCED ? 0 : 700);
    }
    fetch(CFG.endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // text/plain — Apps Script-ке алдын ала (preflight) сұраусыз жетеді
      body: JSON.stringify({ responses: lastPayload.responses, scores: lastPayload.scores }),
      redirect: "follow",
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data || !data.ok) throw new Error((data && data.error) || "server");
        state.sent = true;
        clearStore();
        state.step = "done";
        enter = "fwd";
        render();
      })
      .catch((err) => sendFailed(err && err.message));
  }

  function sendFailed(reason) {
    const codeMsg = codeErrors()[reason];
    app.innerHTML = `
      <section class="card center enter enter-fade">
        <h2>${T.failTitle}</h2>
        <p class="hint">${codeMsg || T.failHint}</p>
        <div class="actions">
          <button class="btn primary" data-act="retry">${T.retry}</button>
          <button class="btn ghost" data-act="file">${T.saveFile}</button>
        </div>
        <p class="hint small">${T.failSmall}</p>
      </section>`;
    app.onclick = (e) => {
      if (e.target.closest("[data-act=retry]")) return send();
      if (e.target.closest("[data-act=file]")) return download();
    };
  }

  function download() {
    const data = JSON.stringify({ responses: lastPayload.responses, scores: lastPayload.scores }, null, 2);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    a.download = "zhauaptar-" + state.submissionId + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------- 8. Соңы ----------
  function confetti() {
    if (REDUCED) return "";
    const colors = ["#f4b740", "#0e86b4", "#7cc6e4", "#12233f", "#f7d27a"];
    let out = "";
    for (let i = 0; i < 28; i++) {
      const x = Math.round(Math.random() * 100);
      const d = (Math.random() * 0.6).toFixed(2);
      const r = Math.round(Math.random() * 360);
      const dx = Math.round(Math.random() * 80 - 40);
      out += `<i style="--x:${x}%;--d:${d}s;--r:${r}deg;--dx:${dx}px;background:${colors[i % colors.length]}"></i>`;
    }
    return `<div class="confetti" aria-hidden="true">${out}</div>`;
  }

  function done() {
    const view = lastPayload ? lastPayload.view : null;
    const show = CFG.showResultToStudent && view && view.quality.valid;
    const invalid = CFG.showResultToStudent && view && !view.quality.valid;
    const first = state.student.name.trim().split(/\s+/)[0] || "";
    app.innerHTML = `
      <section class="card center done${enterCls()}">
        ${invalid ? "" : confetti()}
        <svg class="peak" viewBox="0 0 120 90" aria-hidden="true" focusable="false">
          <path class="near" d="M4 86 L50 22 L74 54 L88 40 L116 86Z"/><path class="flag" d="M50 22 V4 L66 10 L50 16"/>
        </svg>
        <h2>${T.doneTitle}</h2>
        <p class="lead">${esc(show ? T.doneLeadResult(first) : T.doneLead(first))}</p>
        ${invalid ? `<div class="result"><h3>${T.invalidTitle}</h3><p class="hint">${T.invalidText}</p></div>` : ""}
        ${
          show
            ? `<div class="result"><h3>${T.resultTitle}</h3>
            <ol>${state.ranking.concat(state.added ? [state.added] : []).map((c, i) => `<li style="--i:${i}">${esc(fieldName(c))}</li>`).join("")}</ol>
            ${
              view.fin.pairs.length
                ? `<h3>${T.pairsTitle}</h3><ul class="pairs">${view.fin.pairs.map((p, i) => `<li style="--i:${i}">${esc(pairLabel(p))}</li>`).join("")}</ul>`
                : ""
            }
            <p class="hint">${T.resultHint}</p></div>`
            : ""
        }
        ${CFG.endpoint ? "" : `<p class="demo">${T.demoDone} <button class="link" data-act="file">${T.download}</button></p>`}
        ${CFG.contact ? `<p class="hint">${T.contact} ${esc(CFG.contact)}</p>` : ""}
      </section>`;
    app.onclick = (e) => {
      if (e.target.closest("[data-act=file]") && lastPayload) download();
    };
  }

  // сынақ пен тексеру үшін
  window.__app = { getState: () => state, buildPayload, setLang };

  applyChrome();
  render();
})();
