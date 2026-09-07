(() => {
  'use strict';

  const app = document.getElementById('app');
  const ES = window.CONTENT_ES;
  const CONFIG = window.CONFIG;
  let memory = null;
  let timerId = null;
  let renderedScreen = null;
  let syncInFlight = false;
  let syncVersion = 0;

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  const uuid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const fresh = () => ({
    version: CONFIG.stateVersion,
    screen: 'lang',
    lang: null,
    alias: '',
    sessionId: uuid(),
    startedAt: null,
    finishedAt: null,
    activeTimer: null,
    timerDeadline: null,
    timeoutNotice: false,
    timeouts: [],
    deliberation: {},
    interactions: [],
    events: [],
    seleccion: {
      elegidas: [],
      prioridades: [],
      candidato: null,
      puzzleIndex: 0,
      puzzleSelection: {},
      puzzleOrder: {},
      puzzleFeedback: {},
    },
    onboarding: {
      ranking: [],
      enfoque: {},
      descuidada: null,
      focusIndex: 0,
      actionOrder: {},
      mirrorSeen: {},
    },
    retos: {
      ids: [],
      index: 0,
      choices: {},
      order: {},
      feedback: {},
    },
    pendingSync: false,
    lastSyncAt: null,
  });

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG.storageKey));
      return saved?.version === CONFIG.stateVersion ? saved : null;
    } catch {
      return memory;
    }
  }

  const loaded = load();
  let state = loaded || fresh();
  if (!Array.isArray(state.events)) state.events = [];
  let showResume = Boolean(loaded && !loaded.finishedAt && loaded.screen !== 'lang');

  function save() {
    memory = state;
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(state));
    } catch {}
  }

  const C = () => (state.lang === 'pt' && window.CONTENT_PT) || ES;
  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
  const replace = (text, values = {}) => Object.entries(values)
    .reduce((result, [key, value]) => result.replaceAll(`{${key}}`, value), String(text ?? ''));
  const byId = (items, id) => items.find((item) => item.id === id);
  const candidate = () => byId(C().CANDIDATES, state.seleccion.candidato);
  const fmt = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  function shuffledIndices(length) {
    const result = Array.from({ length }, (_, index) => index);
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
  }

  function ordered(key, items, store) {
    if (!store[key] || store[key].length !== items.length) store[key] = shuffledIndices(items.length);
    return store[key].map((index) => ({ ...items[index], originalIndex: String(index) }));
  }

  function startTimer(section) {
    state.activeTimer = section;
    state.timerDeadline = Date.now() + CONFIG.timers[section] * 1000;
    state.timeoutNotice = false;
  }

  function stopTimer() {
    state.activeTimer = null;
    state.timerDeadline = null;
  }

  function timeLeft() {
    if (!state.activeTimer || !state.timerDeadline) return 0;
    return Math.max(0, Math.ceil((state.timerDeadline - Date.now()) / 1000));
  }

  function handleTimeout() {
    if (!state.activeTimer || timeLeft() > 0) return false;
    const marker = `${state.activeTimer}:${state.screen}`;
    if (!state.timeouts.includes(marker)) state.timeouts.push(marker);
    stopTimer();
    state.timeoutNotice = true;
    save();
    render();
    return true;
  }

  function startDeliberation(key) {
    state.deliberation[key] = Date.now();
  }

  function deliberationLeft(key, durationKey) {
    const started = state.deliberation[key];
    if (!started) return 0;
    return Math.max(0, Math.ceil((started + CONFIG.deliberationMin[durationKey] * 1000 - Date.now()) / 1000));
  }

  function primary(label, action, disabled = false, extra = '') {
    return `<button class="button primary" data-action="${action}" ${disabled ? 'disabled' : ''} ${extra}>${esc(label)}</button>`;
  }

  function shell(body) {
    const content = C();
    const subtitle = content.ui.subtitle || CONFIG.subtitle;
    const timer = state.activeTimer
      ? `<div class="timer"><span>${esc(content.app.sections[state.activeTimer])}</span><strong data-timer>${fmt(timeLeft())}</strong></div>`
      : '';
    const offline = !navigator.onLine ? `<p class="notice" role="status">${esc(content.app.offline)}</p>` : '';
    const timeout = state.timeoutNotice ? `<p class="notice timeout-notice" role="status">${esc(content.app.timeout)}</p>` : '';
    return `<div class="app-shell"><header class="topbar"><div><p class="brand"><span>Full <i>Bloom</i></span></p><p class="tagline">${esc(subtitle)}</p></div>${timer}</header>${offline}${timeout}<section class="screen">${body}</section></div>`;
  }

  function option(item, selected, action, extra = '', stateClass = '', disabled = false) {
    return `<button class="option ${selected ? 'selected' : ''} ${stateClass}" data-action="${action}" ${extra} aria-pressed="${selected}" ${disabled ? 'disabled' : ''}><b>${esc(item.marker ?? '')}</b><span>${esc(item.text ?? item.t ?? item.label ?? item.name)}</span></button>`;
  }

  function go(screen) {
    state.screen = screen;
    save();
    render();
  }

  function renderLang() {
    const { ui } = C();
    app.innerHTML = `<div class="app-shell intro"><section class="screen intro-screen"><p class="brand large"><span>Full <i>Bloom</i></span></p><p class="tagline">${esc(ui.subtitle || CONFIG.subtitle)}</p><h1>${esc(ui.landing)}</h1><div class="language-actions"><button class="language-button" data-action="lang" data-lang="es">${esc(ui.langES)}</button><button class="language-button" data-action="lang" data-lang="pt">${esc(ui.langPT)}</button></div></section><footer class="welcome-credit">© 2026, <a href="https://danwar77.github.io/hologram-web/" target="_blank" rel="noopener noreferrer">Danwar77</a></footer></div>`;
  }

  function renderWelcome() {
    const { ui } = C();
    app.innerHTML = shell(`<p class="eyebrow">Full Bloom</p><h1>${esc(ui.welcomeTitle)}</h1><p class="lead">${esc(replace(ui.welcome, { min: CONFIG.durationLabel }))}</p><label class="field"><span>${esc(ui.teamQ)}</span><input id="team-alias" maxlength="30" autocomplete="off" placeholder="${esc(ui.aliasPh)}" value="${esc(state.alias)}"></label><div class="action-bar">${primary(ui.start, 'start', !state.alias.trim())}</div>`);
  }

  function renderReq() {
    const content = C();
    const groups = {};
    content.POOL.forEach((item) => (groups[item.block] ||= []).push(item));
    const cards = Object.entries(groups).map(([block, items]) => `<section class="pool-group"><h2>${esc(block)}</h2><div class="trait-grid">${items.map((item) => {
      const selected = state.seleccion.elegidas.includes(item.id);
      return `<article class="trait ${selected ? 'selected' : ''}"><button data-action="req-toggle" data-id="${item.id}" aria-pressed="${selected}"><span class="trait-index">${selected ? '✓' : '○'}</span><strong>${esc(item.name)}</strong></button></article>`;
    }).join('')}</div></section>`).join('');
    const count = state.seleccion.elegidas.length;
    const wait = deliberationLeft('req', 'req');
    const ready = state.seleccion.elegidas
      .map((id) => byId(content.POOL, id))
      .filter((item) => item && !item.dist && content.PUZZLES[item.id]).length >= CONFIG.numPriorities;
    app.innerHTML = shell(`<p class="eyebrow">${esc(content.app.sections.sel)}</p><h1>${esc(content.app.reqTitle)}</h1><p class="lead">${esc(content.ui.req)}</p><p class="selection-count">${esc(replace(content.ui.reqCount, { n: count, min: CONFIG.numPriorities }))}</p><div class="pool-list">${cards}</div><div class="action-bar"><p class="helper" data-delib-count="req">${wait ? fmt(wait) : ''}</p>${primary(content.ui.reqNext, 'req-next', !ready || wait > 0, `data-deliberation="req" data-duration="req" data-ready="${ready ? '1' : '0'}"`)}</div>`);
  }

  function eligibleSelections() {
    return state.seleccion.elegidas
      .map((id) => byId(C().POOL, id))
      .filter((item) => item && !item.dist && C().PUZZLES[item.id])
      .sort((a, b) => b.w - a.w);
  }

  function renderPriorities() {
    const content = C();
    const items = eligibleSelections();
    app.innerHTML = shell(`<p class="eyebrow">${esc(content.app.sections.sel)}</p><h1>${esc(content.app.prioritiesTitle)}</h1><p class="lead">${esc(content.ui.priorities)}</p><div class="options">${items.map((item) => {
      const rank = state.seleccion.prioridades.indexOf(item.id);
      return option({ marker: rank >= 0 ? rank + 1 : '+', text: item.name }, rank >= 0, 'priority', `data-id="${item.id}"`);
    }).join('')}</div><div class="action-bar">${primary(content.ui.prioNext, 'prio-next', state.seleccion.prioridades.length !== CONFIG.numPriorities)}</div>`);
  }

  function currentPuzzle() {
    const id = state.seleccion.prioridades[state.seleccion.puzzleIndex];
    return { id, puzzle: C().PUZZLES[id] };
  }

  function renderPuzzle() {
    const content = C();
    const { id, puzzle } = currentPuzzle();
    if (!id || !puzzle) {
      startDeliberation('candidate');
      go('candidates');
      return;
    }
    const selection = state.seleccion.puzzleSelection[id] || [];
    const feedback = state.seleccion.puzzleFeedback[id];
    const items = ordered(id, puzzle.options, state.seleccion.puzzleOrder);
    const competence = byId(content.POOL, id)?.name || id;
    const options = items.map((item, index) => option({ marker: 'ABCDE'[index], text: item.t }, selection.includes(item.originalIndex), 'puzzle-choice', `data-id="${item.originalIndex}" data-multi="${Boolean(puzzle.multi)}"`, '', Boolean(feedback?.ok))).join('');
    const note = feedback ? `<p class="puzzle-feedback ${feedback.kind}">${esc(feedback.text)}</p>` : '';
    const action = feedback?.ok
      ? primary(content.ui.next, 'puzzle-next')
      : primary(content.ui.confirm, 'puzzle-check', selection.length === 0);
    app.innerHTML = shell(`<p class="eyebrow">${esc(content.app.sections.sel)} · ${state.seleccion.puzzleIndex + 1}/${CONFIG.numPriorities}</p><h1>${esc(competence)}</h1><p class="lead">${esc(puzzle.multi ? content.ui.puzzleMulti : content.ui.puzzleSingle)}</p><div class="options">${options}</div>${note}<div class="action-bar">${action}</div>`);
  }

  function evaluatePuzzle() {
    const content = C();
    const { id, puzzle } = currentPuzzle();
    const selected = state.seleccion.puzzleSelection[id] || [];
    const correct = puzzle.options.map((item, index) => item.correct ? String(index) : null).filter(Boolean);
    if (puzzle.multi) {
      const wrong = selected.find((index) => !puzzle.options[Number(index)].correct);
      if (wrong !== undefined) {
        state.seleccion.puzzleFeedback[id] = { kind: 'bad', text: `${content.ui.porQueNoMejor} ${puzzle.options[Number(wrong)].why}` };
      } else if (selected.length !== correct.length || !correct.every((index) => selected.includes(index))) {
        state.seleccion.puzzleFeedback[id] = { kind: 'near', text: content.ui.faltaUna };
      } else {
        state.seleccion.puzzleFeedback[id] = { kind: 'good', ok: true, text: content.ui.detectaOkMulti };
      }
    } else {
      const item = puzzle.options[Number(selected[0])];
      if (item.correct) state.seleccion.puzzleFeedback[id] = { kind: 'good', ok: true, text: content.ui.detectaOk };
      else if (item.near) state.seleccion.puzzleFeedback[id] = { kind: 'near', text: item.near };
      else state.seleccion.puzzleFeedback[id] = { kind: 'bad', text: `${content.ui.porQueNoMejor} ${item.why}` };
      if (!item.correct) state.seleccion.puzzleSelection[id] = [];
    }
    const feedback = state.seleccion.puzzleFeedback[id];
    const intento = state.events.filter((event) => event.fase === 'deteccion' && event.itemId === id).length + 1;
    const resultado = feedback.kind === 'good' ? 'correcto' : feedback.kind === 'near' ? 'casi' : 'incorrecto';
    logEvent('deteccion', {
      itemId: id,
      item: byId(content.POOL, id)?.name || id,
      intento,
      elegido: selected.map((index) => puzzle.options[Number(index)].t).join(' | '),
      correcto: correct.map((index) => puzzle.options[Number(index)].t).join(' | '),
      resultado,
      esError: resultado !== 'correcto',
    });
    save();
    render();
  }

  function renderCandidates() {
    const content = C();
    const cards = content.CANDIDATES.map((item) => {
      const selected = state.seleccion.candidato === item.id;
      const checks = content.REQS.map((requirement, index) => `<li class="${item.met[index] ? 'met' : 'unmet'}"><span class="check-indicator" aria-hidden="true"></span><span>${esc(requirement)}</span></li>`).join('');
      return `<article class="candidate ${selected ? 'selected' : ''}"><button data-action="candidate" data-id="${item.id}" aria-pressed="${selected}"><div class="candidate-heading"><img class="candidate-photo" src="${esc(item.photo)}" alt="${esc(replace(content.app.candidatePhotoAlt, { nombre: item.name }))}"><div><p class="axis-label">${esc(item.tag)} · ${item.age}</p><h2>${esc(item.name)}</h2></div></div><p>${esc(item.destaca.join(' · '))}</p><p><b>${esc(content.app.cv)}:</b> ${esc(item.cv)}</p><h3>${esc(content.app.requirements)}</h3><ul class="checklist">${checks}</ul></button></article>`;
    }).join('');
    const wait = deliberationLeft('candidate', 'candidate');
    const ready = Boolean(state.seleccion.candidato);
    app.innerHTML = shell(`<p class="eyebrow">${esc(content.app.sections.sel)}</p><h1>${esc(content.app.candidatesTitle)}</h1><p class="lead">${esc(content.ui.candidates)}</p><div class="candidate-list">${cards}</div><div class="action-bar"><p class="helper" data-delib-count="candidate">${wait ? fmt(wait) : ''}</p>${primary(content.ui.hire, 'hire', !ready || wait > 0, `data-deliberation="candidate" data-duration="candidate" data-ready="${ready ? '1' : '0'}"`)}</div>`);
  }

  function renderObDiag() {
    const content = C();
    const person = candidate();
    const gaps = content.REQS.filter((_, index) => !person.met[index]);
    app.innerHTML = shell(`<p class="eyebrow">${esc(content.app.sections.onb)}</p><h1>${esc(replace(content.ui.obDiagTitle, { nombre: person.name }))}</h1><p class="lead">${esc(content.ui.obDiagIntro)}</p><div class="diagnosis-grid"><article class="diagnosis-card strengths"><h2>${esc(content.ui.strengths)}</h2><ul>${person.destaca.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></article><article class="diagnosis-card development"><h2>${esc(content.ui.devAreas)}</h2><ul>${gaps.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></article></div><div class="action-bar">${primary(content.ui.obPlan, 'ob-plan')}</div>`);
  }

  function renderRanking() {
    const content = C();
    const person = candidate();
    app.innerHTML = shell(`<p class="eyebrow">${esc(content.app.sections.onb)}</p><h1>${esc(content.app.rankingTitle)}</h1><p class="lead">${esc(replace(content.ui.ranking, { nombre: person.name }))}</p><div class="options">${content.DIMENSIONS.map((dimension) => {
      const rank = state.onboarding.ranking.indexOf(dimension.id);
      return option({ marker: rank >= 0 ? rank + 1 : '+', text: dimension.label }, rank >= 0, 'rank', `data-id="${dimension.id}"`);
    }).join('')}</div><div class="action-bar">${primary(content.ui.rankNext, 'rank-next', state.onboarding.ranking.length !== content.DIMENSIONS.length)}</div>`);
  }

  function currentDimension() {
    const id = state.onboarding.ranking[state.onboarding.focusIndex];
    return byId(C().DIMENSIONS, id);
  }

  function mirrorLists(dimension, selected) {
    const content = C();
    const chosen = dimension.actions.filter((item, index) => item.int && selected.includes(String(index)));
    const missed = dimension.actions.filter((item, index) => item.int && !selected.includes(String(index)));
    const list = (items) => `<ul>${items.map((item) => `<li>${esc(replace(item.t, { nombre: candidate().name }))}</li>`).join('')}</ul>`;
    return `<div class="mirror-columns"><section><h3>${esc(content.app.selectedIntentional)}</h3>${list(chosen)}</section><section><h3>${esc(content.app.missedIntentional)}</h3>${list(missed)}</section></div>`;
  }

  function renderFocus() {
    const content = C();
    const dimension = currentDimension();
    if (!dimension) {
      go('reveal');
      return;
    }
    const selected = state.onboarding.enfoque[dimension.id] || [];
    const mirrored = Boolean(state.onboarding.mirrorSeen[dimension.id]);
    const actions = ordered(dimension.id, dimension.actions, state.onboarding.actionOrder);
    const choices = actions.map((item, index) => option({ marker: selected.includes(item.originalIndex) ? '✓' : '○', text: replace(item.t, { nombre: candidate().name }) }, selected.includes(item.originalIndex), 'focus-action', `data-id="${item.originalIndex}"`, '', mirrored)).join('');
    const mirror = mirrored ? `<article class="mirror-card"><h2>${esc(dimension.label)}</h2>${mirrorLists(dimension, selected)}<p>${esc(replace(dimension.mirror, { nombre: candidate().name }))}</p></article>` : '';
    const action = mirrored ? primary(content.ui.next, 'focus-next') : primary(content.ui.confirm, 'focus-confirm', selected.length === 0);
    app.innerHTML = shell(`<p class="eyebrow">${esc(content.app.sections.onb)} · ${state.onboarding.focusIndex + 1}/3</p><h1>${esc(dimension.label)}</h1><p class="lead">${esc(replace(content.ui.enfoquePrompt, { nombre: candidate().name }))}</p><div class="options">${choices}</div>${mirror}<div class="action-bar">${action}</div>`);
  }

  function renderReveal() {
    const content = C();
    const dimensions = state.onboarding.ranking.slice(0, 3).map((id) => byId(content.DIMENSIONS, id));
    const neglected = byId(content.DIMENSIONS, state.onboarding.descuidada);
    const summaries = dimensions.map((dimension) => `<article class="lesson"><h2>${esc(dimension.label)}</h2><p><b>${esc(dimension.principio)}</b></p><p>${esc(replace(dimension.mirror, { nombre: candidate().name }))}</p></article>`).join('');
    app.innerHTML = shell(`<p class="eyebrow">${esc(content.app.sections.onb)}</p><h1>${esc(content.ui.revealTitle)}</h1><div class="lesson-list">${summaries}</div><article class="lesson flanco-card"><h2>${esc(content.ui.flanco)}</h2><p>${esc(replace(content.ui.flancoTxt, { dim: neglected?.label || '' }))}</p><p><b>${esc(neglected?.principio || '')}</b></p></article><div class="action-bar">${primary(content.ui.toRetos, 'to-retos')}</div>`);
  }

  function prepareChallenges() {
    const ids = [...candidate().shadows];
    if (ids.length < 3) ids.push('generic');
    state.retos.ids = ids;
    state.retos.index = 0;
    startDeliberation('reto:0');
  }

  function currentChallenge() {
    const id = state.retos.ids[state.retos.index];
    return { id, item: id === 'generic' ? C().GENERIC : C().CHALLENGES[id] };
  }

  function renderChallengeFeedback(item, selected) {
    const content = C();
    if (item.multi) {
      const details = selected.map((index) => {
        const choice = item.options[Number(index)];
        return `<li class="${choice.valid ? 'feedback-valid' : 'feedback-invalid'}"><b>${choice.valid ? content.ui.suma : content.ui.porQueNoMejorReto}</b> ${esc(choice.porQue)}</li>`;
      }).join('');
      return `<div class="challenge-feedback"><ul>${details}</ul><p class="rule">${esc(item.mejorEnfoque)}</p><p class="eic-note">${esc(content.app.eicNote)}</p></div>`;
    }
    const choice = item.options[Number(selected[0])];
    return `<p class="puzzle-feedback ${choice.best ? 'good' : 'bad'}"><b>${esc(choice.best ? content.ui.porQueMejor : content.ui.porQueNoMejorReto)}</b> ${esc(replace(choice.porQue, { nombre: candidate().name }))}</p><p class="eic-note">${esc(content.app.eicNote)}</p>`;
  }

  function renderChallenge() {
    const content = C();
    const { id, item } = currentChallenge();
    if (!id || !item) {
      finishGame();
      return;
    }
    const selected = state.retos.choices[id] || [];
    const feedback = Boolean(state.retos.feedback[id]);
    const options = ordered(id, item.options, state.retos.order).map((choice, index) => {
      let stateClass = '';
      if (feedback) stateClass = choice.valid || choice.best ? 'good' : 'rejected';
      return option({ marker: 'ABCDEF'[index], text: replace(choice.t, { nombre: candidate().name }) }, selected.includes(choice.originalIndex), 'challenge-choice', `data-id="${choice.originalIndex}" data-multi="${Boolean(item.multi)}"`, stateClass, feedback);
    }).join('');
    const waitKey = `reto:${state.retos.index}`;
    const wait = deliberationLeft(waitKey, 'reto');
    const ready = selected.length > 0;
    const progress = replace(content.app.challengeProgress, { n: state.retos.index + 1, total: state.retos.ids.length });
    const note = feedback ? renderChallengeFeedback(item, selected) : '';
    const action = feedback
      ? primary(state.retos.index + 1 < state.retos.ids.length ? content.app.challengeNext : content.app.finish, 'challenge-next')
      : primary(content.ui.register, 'challenge-confirm', !ready || wait > 0, `data-deliberation="${waitKey}" data-duration="reto" data-ready="${ready ? '1' : '0'}"`);
    app.innerHTML = shell(`<p class="eyebrow">${esc(content.app.sections.ret)} · ${esc(progress)}</p><h1>${esc(item.fortaleza)}</h1><p class="lead">${esc(replace(content.ui.retoIntro, { nombre: candidate().name }))}</p><p class="rule"><b>${esc(content.app.challengeLabel)}:</b> ${esc(item.reto)}</p><h2>${esc(replace(item.esc, { nombre: candidate().name }))}</h2><div class="options case-options">${options}</div>${note}<div class="action-bar"><p class="helper" data-delib-count="${waitKey}">${wait ? fmt(wait) : ''}</p>${action}</div>`);
  }

  function finishGame() {
    stopTimer();
    state.finishedAt = new Date().toISOString();
    state.screen = 'close';
    queueSync();
    save();
    render();
  }

  function renderClose() {
    const content = C();
    const syncStatus = state.pendingSync ? content.app.syncPending : state.lastSyncAt ? content.app.syncDone : '';
    app.innerHTML = shell(`<p class="eyebrow">Full Bloom</p><h1>${esc(content.CLOSE.title)}</h1><div class="close-copy">${content.CLOSE.lines.map((line) => `<p class="lead">${esc(line)}</p>`).join('')}</div><p class="quote">${esc(content.CLOSE.final)}</p><p class="sync-status" role="status">${esc(syncStatus)}</p><div class="action-bar">${primary(content.ui.restart, 'restart')}</div>`);
  }

  function renderResume() {
    const content = C();
    app.insertAdjacentHTML('beforeend', `<div class="modal-backdrop"><section class="resume-modal" role="dialog" aria-modal="true"><h1>${esc(content.app.resumeTitle)}</h1><p>${esc(content.app.resumeText)}</p>${primary(content.app.resume, 'resume')}<button class="button secondary" data-action="restart">${esc(content.app.newGame)}</button></section></div>`);
  }

  function render() {
    const changed = renderedScreen !== state.screen;
    const routes = {
      lang: renderLang,
      welcome: renderWelcome,
      req: renderReq,
      priorities: renderPriorities,
      puzzle: renderPuzzle,
      candidates: renderCandidates,
      obDiag: renderObDiag,
      ranking: renderRanking,
      enfoque: renderFocus,
      reveal: renderReveal,
      retos: renderChallenge,
      close: renderClose,
    };
    (routes[state.screen] || renderLang)();
    if (showResume) renderResume();
    if (changed) {
      window.scrollTo(0, 0);
      renderedScreen = state.screen;
    }
    ensureClock();
  }

  const ACTION_LABELS = {
    lang: 'Seleccionar idioma', start: 'Comenzar juego', 'req-toggle': 'Cambiar competencia',
    'req-next': 'Continuar a prioridades', priority: 'Cambiar prioridad', 'prio-next': 'Comenzar entrevista',
    'puzzle-choice': 'Elegir respuesta de entrevista', 'puzzle-check': 'Confirmar respuesta de entrevista',
    'puzzle-next': 'Siguiente pregunta', candidate: 'Seleccionar candidato', hire: 'Contratar candidato',
    'ob-plan': 'Crear plan de onboarding', rank: 'Ordenar dimensión', 'rank-next': 'Confirmar orden de dimensiones',
    'focus-action': 'Cambiar acción de onboarding', 'focus-confirm': 'Confirmar acciones de onboarding',
    'focus-next': 'Siguiente dimensión', 'to-retos': 'Comenzar retos',
    'challenge-choice': 'Elegir respuesta del reto', 'challenge-confirm': 'Registrar decisión del reto',
    'challenge-next': 'Siguiente reto o finalizar', resume: 'Continuar partida', restart: 'Reiniciar juego',
  };

  const SCREEN_LABELS = {
    lang: 'Idioma', welcome: 'Identificación del equipo', req: 'Selección de competencias',
    priorities: 'Priorización de competencias', puzzle: 'Entrevista', candidates: 'Selección de candidato',
    obDiag: 'Diagnóstico de onboarding', ranking: 'Prioridades de onboarding', enfoque: 'Plan de onboarding',
    reveal: 'Resumen de onboarding', retos: 'Retos de liderazgo', close: 'Cierre',
  };

  function clickedText(button) {
    const concise = button.querySelector('.candidate-heading h2, .option span, .trait strong');
    return String(concise?.textContent || button.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function logInteraction(button) {
    const pressed = button.getAttribute('aria-pressed');
    const elapsedSeconds = state.startedAt
      ? Math.max(0, Math.round((Date.now() - new Date(state.startedAt).getTime()) / 1000))
      : 0;
    state.interactions.push({
      sequence: state.interactions.length + 1,
      at: new Date().toISOString(),
      elapsedSeconds,
      screen: state.screen,
      screenLabel: SCREEN_LABELS[state.screen] || state.screen,
      action: button.dataset.action,
      actionLabel: ACTION_LABELS[button.dataset.action] || button.dataset.action,
      targetId: button.dataset.id || button.dataset.lang || '',
      text: clickedText(button),
      selection: pressed === null ? 'acción' : pressed === 'true' ? 'deseleccionar' : 'seleccionar',
    });
  }

  function logEvent(fase, data = {}) {
    if (!Array.isArray(state.events)) state.events = [];
    state.events.push({
      id: uuid(),
      ts: new Date().toISOString(),
      sessionId: state.sessionId,
      equipo: state.alias,
      idioma: state.lang,
      fase,
      itemId: data.itemId || '',
      item: data.item || '',
      intento: data.intento || '',
      elegido: data.elegido || '',
      correcto: data.correcto || '',
      resultado: data.resultado || 'n/a',
      esError: data.esError === true,
    });
    queueSync();
  }

  function record() {
    const content = C();
    const poolLabel = (id) => byId(content.POOL, id)?.name || id;
    const dimensionLabel = (id) => byId(content.DIMENSIONS, id)?.label || id;
    const selectedCandidate = byId(content.CANDIDATES, state.seleccion.candidato);
    const enfoqueLabels = Object.fromEntries(Object.entries(state.onboarding.enfoque).map(([dimensionId, choices]) => {
      const dimension = byId(content.DIMENSIONS, dimensionId);
      return [dimensionLabel(dimensionId), (choices || []).map((index) => replace(dimension?.actions?.[Number(index)]?.t || index, { nombre: selectedCandidate?.name || '' }))];
    }));
    const retos = state.retos.ids.map((id) => {
      const item = id === 'generic' ? content.GENERIC : content.CHALLENGES[id];
      const selected = state.retos.choices[id] || [];
      return {
        retoId: id,
        fortaleza: item?.fortaleza || id,
        reto: item?.reto || '',
        escenario: replace(item?.esc || '', { nombre: selectedCandidate?.name || '' }),
        eleccion: selected,
        eleccionTextos: selected.map((index) => replace(item?.options?.[Number(index)]?.t || index, { nombre: selectedCandidate?.name || '' })),
      };
    });
    return {
      schemaVersion: 2,
      sessionId: state.sessionId,
      alias: state.alias,
      lang: state.lang,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      seleccion: {
        elegidas: state.seleccion.elegidas,
        elegidasLabels: state.seleccion.elegidas.map(poolLabel),
        prioridades: state.seleccion.prioridades,
        prioridadesLabels: state.seleccion.prioridades.map(poolLabel),
        candidato: state.seleccion.candidato,
        candidatoNombre: selectedCandidate?.name || '',
        candidatoPerfil: selectedCandidate ? `${selectedCandidate.tag} · ${selectedCandidate.age}` : '',
      },
      onboarding: {
        ranking: state.onboarding.ranking,
        rankingLabels: state.onboarding.ranking.map(dimensionLabel),
        enfoque: state.onboarding.enfoque,
        enfoqueLabels,
        descuidada: state.onboarding.descuidada,
        descuidadaLabel: dimensionLabel(state.onboarding.descuidada),
      },
      retos,
      interactions: state.interactions,
      timeouts: state.timeouts,
      events: state.events,
    };
  }

  function queueSync() {
    if (!CONFIG.sheetEndpoint) return;
    state.pendingSync = true;
    syncVersion += 1;
    save();
    syncToSheet();
  }

  async function syncToSheet() {
    if (!CONFIG.sheetEndpoint || !state.pendingSync || !navigator.onLine || syncInFlight) return;
    const sendingVersion = syncVersion;
    let sent = false;
    syncInFlight = true;
    try {
      await fetch(CONFIG.sheetEndpoint, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(record()),
      });
      state.pendingSync = syncVersion !== sendingVersion;
      state.lastSyncAt = new Date().toISOString();
      save();
      render();
      sent = true;
    } catch {
      save();
    } finally {
      syncInFlight = false;
      if (sent && state.pendingSync && navigator.onLine) syncToSheet();
    }
  }

  function ensureClock() {
    const waiting = Object.entries(state.deliberation).some(([key]) => {
      const duration = key.startsWith('reto:') ? 'reto' : key;
      return CONFIG.deliberationMin[duration] && deliberationLeft(key, duration) > 0;
    });
    if (!state.activeTimer && !waiting) {
      clearInterval(timerId);
      timerId = null;
      return;
    }
    if (timerId !== null) return;
    timerId = setInterval(() => {
      if (handleTimeout()) return;
      const timer = app.querySelector('[data-timer]');
      if (timer) timer.textContent = fmt(timeLeft());
      app.querySelectorAll('[data-deliberation]').forEach((button) => {
        const key = button.dataset.deliberation;
        const duration = button.dataset.duration;
        const wait = deliberationLeft(key, duration);
        const counter = app.querySelector(`[data-delib-count="${CSS.escape(key)}"]`);
        if (counter) counter.textContent = wait ? fmt(wait) : '';
        button.disabled = wait > 0 || button.dataset.ready !== '1';
      });
    }, 500);
  }

  app.addEventListener('input', (event) => {
    if (event.target.id !== 'team-alias') return;
    state.alias = event.target.value.slice(0, 30);
    save();
    const button = app.querySelector('[data-action="start"]');
    if (button) button.disabled = !state.alias.trim();
  });

  app.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    logInteraction(button);

    if (action === 'lang') {
      state.lang = button.dataset.lang;
      go('welcome');
    } else if (action === 'start') {
      if (!state.alias.trim()) return;
      state.startedAt = new Date().toISOString();
      startTimer('selA');
      startDeliberation('req');
      go('req');
    } else if (action === 'req-toggle') {
      const id = button.dataset.id;
      state.seleccion.elegidas = state.seleccion.elegidas.includes(id)
        ? state.seleccion.elegidas.filter((item) => item !== id)
        : [...state.seleccion.elegidas, id];
      save();
      render();
    } else if (action === 'req-next') {
      const chosen = state.seleccion.elegidas.map((id) => byId(C().POOL, id)).filter(Boolean);
      logEvent('competencias', {
        elegido: chosen.map((item) => `${item.name}${item.dist ? ' (distractor)' : ''}`).join(' | '),
        resultado: 'n/a',
        esError: chosen.some((item) => item.dist),
      });
      go('priorities');
    } else if (action === 'priority') {
      const id = button.dataset.id;
      const selected = state.seleccion.prioridades;
      state.seleccion.prioridades = selected.includes(id)
        ? selected.filter((item) => item !== id)
        : selected.length < CONFIG.numPriorities ? [...selected, id] : selected;
      save();
      render();
    } else if (action === 'prio-next') {
      logEvent('prioridades', {
        elegido: state.seleccion.prioridades.map((id) => byId(C().POOL, id)?.name || id).join(' | '),
        resultado: 'n/a',
      });
      state.seleccion.puzzleIndex = 0;
      startTimer('selB');
      go('puzzle');
    } else if (action === 'puzzle-choice') {
      const { id } = currentPuzzle();
      const current = state.seleccion.puzzleSelection[id] || [];
      const choice = button.dataset.id;
      state.seleccion.puzzleSelection[id] = button.dataset.multi === 'true'
        ? current.includes(choice) ? current.filter((item) => item !== choice) : [...current, choice]
        : [choice];
      delete state.seleccion.puzzleFeedback[id];
      save();
      render();
    } else if (action === 'puzzle-check') {
      evaluatePuzzle();
    } else if (action === 'puzzle-next') {
      state.seleccion.puzzleIndex += 1;
      if (state.seleccion.puzzleIndex >= CONFIG.numPriorities) {
        startDeliberation('candidate');
        go('candidates');
      } else go('puzzle');
    } else if (action === 'candidate') {
      state.seleccion.candidato = button.dataset.id;
      save();
      render();
    } else if (action === 'hire') {
      logEvent('candidato', {
        itemId: state.seleccion.candidato,
        item: candidate()?.name || state.seleccion.candidato,
        resultado: 'n/a',
      });
      stopTimer();
      startTimer('onb');
      state.screen = 'obDiag';
      save();
      queueSync();
      render();
    } else if (action === 'ob-plan') {
      go('ranking');
    } else if (action === 'rank') {
      const id = button.dataset.id;
      const selected = state.onboarding.ranking;
      state.onboarding.ranking = selected.includes(id)
        ? selected.filter((item) => item !== id)
        : [...selected, id];
      save();
      render();
    } else if (action === 'rank-next') {
      const dimensions = state.onboarding.ranking.map((id) => byId(C().DIMENSIONS, id)?.label || id);
      logEvent('ob_ranking', {
        elegido: dimensions.join(' | '),
        correcto: `descuidada: ${byId(C().DIMENSIONS, state.onboarding.ranking[3])?.label || ''}`,
        resultado: 'n/a',
      });
      state.onboarding.descuidada = state.onboarding.ranking[3];
      state.onboarding.focusIndex = 0;
      go('enfoque');
    } else if (action === 'focus-action') {
      const dimension = currentDimension();
      const current = state.onboarding.enfoque[dimension.id] || [];
      const id = button.dataset.id;
      state.onboarding.enfoque[dimension.id] = current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id];
      save();
      render();
    } else if (action === 'focus-confirm') {
      const dimension = currentDimension();
      const selected = state.onboarding.enfoque[dimension.id] || [];
      const candidateName = candidate()?.name || '';
      const intentional = dimension.actions
        .map((item, index) => ({ text: replace(item.t, { nombre: candidateName }), index: String(index), intentional: item.int }))
        .filter((item) => item.intentional);
      const missed = intentional.filter((item) => !selected.includes(item.index));
      logEvent('ob_enfoque', {
        itemId: dimension.id,
        item: dimension.label,
        elegido: intentional.filter((item) => selected.includes(item.index)).map((item) => item.text).join(' | '),
        correcto: missed.map((item) => item.text).join(' | '),
        resultado: missed.length === 0 ? 'correcto' : 'casi',
        esError: missed.length > 0,
      });
      state.onboarding.mirrorSeen[currentDimension().id] = true;
      save();
      render();
    } else if (action === 'focus-next') {
      state.onboarding.focusIndex += 1;
      if (state.onboarding.focusIndex >= 3) go('reveal');
      else go('enfoque');
    } else if (action === 'to-retos') {
      stopTimer();
      prepareChallenges();
      startTimer('ret');
      go('retos');
    } else if (action === 'challenge-choice') {
      const { id, item } = currentChallenge();
      const current = state.retos.choices[id] || [];
      const choice = button.dataset.id;
      state.retos.choices[id] = item.multi
        ? current.includes(choice) ? current.filter((entry) => entry !== choice) : [...current, choice]
        : [choice];
      save();
      render();
    } else if (action === 'challenge-confirm') {
      const challenge = currentChallenge();
      const selected = state.retos.choices[challenge.id] || [];
      const chosen = selected.map((index) => challenge.item.options[Number(index)]).filter(Boolean);
      const resultado = challenge.item.multi
        ? chosen.length > 0 && chosen.every((item) => item.valid) ? 'correcto' : 'incorrecto'
        : chosen[0]?.best ? 'correcto' : 'incorrecto';
      logEvent('reto', {
        itemId: challenge.id,
        item: challenge.item.fortaleza,
        intento: 1,
        elegido: chosen.map((item) => replace(item.t, { nombre: candidate()?.name || '' })).join(' | '),
        correcto: challenge.item.options
          .filter((item) => item.best || item.valid)
          .map((item) => replace(item.t, { nombre: candidate()?.name || '' }))
          .join(' | '),
        resultado,
        esError: resultado !== 'correcto',
      });
      state.retos.feedback[currentChallenge().id] = true;
      save();
      render();
    } else if (action === 'challenge-next') {
      state.retos.index += 1;
      if (state.retos.index >= state.retos.ids.length) finishGame();
      else {
        startDeliberation(`reto:${state.retos.index}`);
        go('retos');
      }
    } else if (action === 'resume') {
      showResume = false;
      render();
    } else if (action === 'restart') {
      try { localStorage.removeItem(CONFIG.storageKey); } catch {}
      state = fresh();
      showResume = false;
      renderedScreen = null;
      save();
      render();
    }
  });

  window.addEventListener('online', () => {
    syncToSheet();
    render();
  });
  window.addEventListener('offline', render);
  window.addEventListener('popstate', () => {
    history.pushState({ fullBloom: true }, '', location.href);
    render();
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  history.replaceState({ fullBloom: true }, '', location.href);
  render();
  syncToSheet();
})();
