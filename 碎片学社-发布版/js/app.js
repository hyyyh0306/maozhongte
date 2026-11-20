/* 碎片学社 主应用 */
'use strict';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

const MEMORY_TYPES = ['blank', 'short', 'essay', 'bianxi'];   // 背诵模式（考试主观题型）
const QUIZ_TYPES = ['single', 'multi', 'judge', 'blank'];     // 刷题模式（自测）
const TYPE_NAMES = { single: '单选题', multi: '多选题', judge: '判断题', blank: '填空题', short: '简答题', essay: '论述题', bianxi: '辨析题' };

const App = {
  bank: { chapters: [] },
  chapters: [],
  Q: new Map(),
  P: new Map(),
  settings: { budget: 5, tts: true, rate: 0.95, examDate: '2026-11-28' },
  view: 'home',
  recite: null,   // 背诵会话
  reciteScope: 'all', // 背诵范围（章节）
  quiz: null,     // 刷题会话
  review: null,   // 速览当前章
  reviewCloze: false
};

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ---------- 数据加载 ---------- */
async function loadSettings() {
  const s = await DB.get('meta', 'settings');
  if (s) App.settings = { ...App.settings, ...s };
  // 迁移：修复此前错误默认的考试年份（2025 → 2026）
  if (App.settings.examDate === '2025-11-28') App.settings.examDate = '2026-11-28';
}
async function saveSettings() {
  await DB.put('meta', { k: 'settings', ...App.settings });
}

async function loadBank() {
  try {
    const res = await fetch('data/bank/merged.json');
    if (res.ok) App.bank = await res.json();
  } catch (e) { console.warn('bank fetch failed', e); }
  const custom = await DB.get('meta', 'customBank');
  const chapters = (App.bank.chapters || []).slice();
  if (custom && Array.isArray(custom.chapters)) {
    for (const c of custom.chapters) {
      const i = chapters.findIndex((x) => x.chapterId === c.chapterId);
      if (i >= 0) chapters[i] = c; else chapters.push(c);
    }
  }
  App.chapters = chapters;
  App.Q.clear(); App.P.clear();
  for (const c of chapters) {
    (c.questions || []).forEach((q) => App.Q.set(q.id, { ...q, chapterId: c.chapterId, chapterTitle: c.chapterTitle }));
    (c.points || []).forEach((p) => App.P.set(p.id, { ...p, chapterId: c.chapterId, chapterTitle: c.chapterTitle }));
  }
}

/* ---------- TTS 朗读 ---------- */
function speak(text) {
  if (!App.settings.tts || !('speechSynthesis' in window)) return;
  const t = String(text).replace(/_{2,}/g, '（空）');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(t);
  u.lang = 'zh-CN';
  u.rate = App.settings.rate || 0.95;
  const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.startsWith('zh'));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

/* ---------- 视图路由 ---------- */
async function refreshStreak() {
  const el = $('#streak');
  if (el) el.textContent = '🔥' + (await Stats.streak()) + '天';
}

function showView(name) {
  App.view = name;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  $('#top-right').innerHTML = name === 'home' ? '<span id="streak">🔥</span>' : '';
  const v = $('#view');
  if (name === 'home') renderHome(v);
  else if (name === 'recite') renderRecite(v);
  else if (name === 'quiz') renderQuiz(v);
  else if (name === 'review') renderReview(v);
  else renderMe(v);
  if (name === 'home') refreshStreak();
  window.scrollTo(0, 0);
}

/* ---------- 今日 ---------- */
async function renderHome(el) {
  const memIds = [...App.Q.keys()].filter((id) => MEMORY_TYPES.includes(App.Q.get(id).type));
  const due = await SRS.dueIds(memIds);
  const seen = await SRS.seenIds();
  const newCount = memIds.filter((id) => !seen.has(id)).length;
  const todos = await DB.getAll('todo');
  const openTodos = todos.filter((t) => !t.done);
  const today = await Stats.todayCount();
  const streak = await Stats.streak();
  const exam = new Date(App.settings.examDate + 'T00:00:00');
  const days = Math.ceil((exam - new Date()) / 86400000);
  const dText = days > 0 ? '距思政考试还有 <b>' + days + '</b> 天' : (days === 0 ? '今天考试，放轻松！' : '考试已结束');
  const isStandalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  const installBanner = (!isStandalone && !App.settings.hideInstall)
    ? '<div class="card" style="background:#fff8ec;border:1px solid #f3dfb2"><h3>📲 把「碎片学社」装到桌面</h3>' +
      '<div class="sub">装成应用后：全屏、断网可用、和 App 一样快。点「立即安装」按提示操作即可。</div>' +
      '<div class="btn-row"><button class="btn small" id="install-btn">立即安装</button><button class="btn small gray" id="install-x">暂不</button></div></div>'
    : '';

  el.innerHTML =
    '<div class="hero">' +
      '<div class="d-day">📅 目标：思政闭卷 · ' + esc(App.settings.examDate) + '</div>' +
      '<div class="d-main">' + dText + '</div>' +
      '<div class="d-sub">另有 ' + newCount + ' 张新卡待学。拿起手机，先学 2 分钟，而不是刷视频。</div>' +
      '<div class="stat-grid">' +
        '<div class="stat"><div class="num">' + due.length + '</div><div class="lbl">待复习卡</div></div>' +
        '<div class="stat"><div class="num">' + openTodos.length + '</div><div class="lbl">待办</div></div>' +
        '<div class="stat"><div class="num">' + today + '</div><div class="lbl">今日已学</div></div>' +
        '<div class="stat"><div class="num">' + streak + '</div><div class="lbl">连续天数</div></div>' +
      '</div>' +
      '<div class="quick-start">' +
        '<button class="btn" data-b="3">3分钟</button>' +
        '<button class="btn" data-b="5">5分钟</button>' +
        '<button class="btn" data-b="10">10分钟</button>' +
        '<button class="btn" data-b="0">不限时</button>' +
      '</div>' +
    '</div>' + installBanner +
    '<div class="card"><h3>🗒️ 待办（' + openTodos.length + '）</h3>' +
      '<div id="home-todos"></div>' +
      '<div class="todo-add"><input id="quick-todo" placeholder="快速添加一件待办…"><button class="btn small" id="add-quick-todo">添加</button></div>' +
    '</div>' +
    '<div class="card"><h3>📚 使用建议</h3>' +
      '<div class="sub">① 点上方时间按钮直达背诵；② 走路/排队：戴耳机听背；③ 睡前：速览一章；④ 课间：随机 5 题。</div>' +
    '</div>';

  el.querySelectorAll('.quick-start .btn').forEach((b) => b.addEventListener('click', () => startRecite(+b.dataset.b)));
  const ib = el.querySelector('#install-btn');
  if (ib) ib.addEventListener('click', async () => {
    if (window.__installPrompt) { window.__installPrompt.prompt(); }
    else { toast('请用浏览器菜单：⋮ → 添加到主屏幕'); }
    App.settings.hideInstall = true;
    await saveSettings();
    showView('home');
  });
  const ix = el.querySelector('#install-x');
  if (ix) ix.addEventListener('click', async () => {
    App.settings.hideInstall = true;
    await saveSettings();
    showView('home');
  });
  const ht = el.querySelector('#home-todos');
  ht.innerHTML = openTodos.length === 0
    ? '<div class="sub">暂无待办，全部清空啦 🎉</div>'
    : openTodos.slice(0, 4).map((t) => '<div class="todo-item"><span class="txt">' + esc(t.text) + '</span></div>').join('');
  el.querySelector('#add-quick-todo').addEventListener('click', async () => {
    const inp = el.querySelector('#quick-todo');
    const val = inp.value.trim();
    if (!val) return;
    await DB.put('todo', { text: val, done: false, createdAt: Date.now() });
    toast('已添加待办');
    showView('home');
  });
}

/* ---------- 背诵（核心：简答/论述/辨析/填空 + 艾宾浩斯） ---------- */
async function startRecite(budget) {
  const scope = App.reciteScope || 'all';
  let memIds = [...App.Q.keys()].filter((id) => {
    const q = App.Q.get(id);
    return MEMORY_TYPES.includes(q.type) && (scope === 'all' || q.chapterId === scope);
  });
  if (!memIds.length) { toast('该范围没有背诵卡'); return; }
  if (scope === 'weak') {
    const srsAll = await DB.getAll('srs');
    const weak = new Set(srsAll.filter((s) => (s.lapses || 0) > 0).map((s) => s.id));
    memIds = memIds.filter((id) => weak.has(id));
    if (!memIds.length) { toast('还没有易错卡，先去学几轮吧'); return; }
  }
  const due = await SRS.dueIds(memIds);
  const seen = await SRS.seenIds();
  const fresh = memIds.filter((id) => !seen.has(id));
  // 乱序：到期卡与新卡分别打乱，避免每次都是同样开头
  let queue = [...shuffle(due), ...shuffle(fresh)];
  const cap = budget > 0 ? budget * 2 : 60;
  queue = queue.slice(0, Math.max(4, cap));
  if (!queue.length) { toast('今天没有到期卡，去速览逛逛吧'); return; }
  App.recite = { queue, idx: 0, done: 0, again: 0, budget, reins: {} };
  App.view = 'recite';
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === 'recite'));
  renderReciteCard($('#view'));
}

function answerHtml(q) {
  let body;
  if (q.type === 'blank') {
    let i = 0;
    const filled = q.stem.replace(/_{2,}/g, () => '<span class="blank-fill">' + esc(q.answer[i++] || '?') + '</span>');
    body = '<div>' + filled + '</div>';
  } else {
    const lis = (q.answer || []).map((a) => '<li>' + esc(a) + '</li>').join('');
    body = '<ol>' + lis + '</ol>';
  }
  const ansText = (q.answer || []).join('；');
  return '<div class="q-answer">' + body +
    '<button class="voice-btn" id="hear-ans" style="margin-top:8px">🔊 听答案</button></div>' +
    (q.explain ? '<div class="q-explain">💡 ' + esc(q.explain) + '</div>' : '') +
    '<script type="text/plain" data-ans="' + esc(ansText) + '"></script>';
}

function renderReciteCard(el) {
  const s = App.recite;
  if (!s || s.idx >= s.queue.length) return renderReciteDone(el);
  const q = App.Q.get(s.queue[s.idx]);
  const total = s.queue.length;
  const pct = Math.round(s.idx / total * 100);
  el.innerHTML =
    '<div class="recite-progress"><span>' + (s.idx + 1) + '/' + total + '</span>' +
      '<span class="bar"><i style="width:' + pct + '%"></i></span>' +
      '<button class="voice-btn" id="tts-btn">🔊 听题</button></div>' +
    '<div class="card">' +
      '<span class="type-badge">' + TYPE_NAMES[q.type] + '</span><span class="chapter-badge">' + esc(q.chapterTitle) + '</span>' +
      '<div class="q-stem">' + esc(q.stem) + '</div>' +
      '<div id="answer-zone"></div>' +
      '<button class="btn block ghost" id="show-ans">显示答案</button>' +
    '</div>' +
    '<div class="grade-row" id="grade-row" style="display:none">' +
      '<button class="btn again" data-g="0">😵 忘了</button>' +
      '<button class="btn hard" data-g="1">🤔 模糊</button>' +
      '<button class="btn good" data-g="2">😄 记得</button>' +
    '</div>';

  el.querySelector('#tts-btn').addEventListener('click', () => speak(q.stem));
  el.querySelector('#show-ans').addEventListener('click', () => {
    el.querySelector('#answer-zone').innerHTML = answerHtml(q);
    el.querySelector('#show-ans').style.display = 'none';
    el.querySelector('#grade-row').style.display = 'flex';
    const hear = el.querySelector('#hear-ans');
    if (hear) hear.addEventListener('click', () => speak(q.answer.join('；')));
  });
  el.querySelectorAll('#grade-row .btn').forEach((b) => b.addEventListener('click', async () => {
    const g = +b.dataset.g;
    await SRS.grade(q.id, g);
    if (g === 0) s.again++;
    // 忘了/模糊的卡：随机插入到后面 2~6 张处再次出现（每张本轮最多重现 2 次）
    if (g !== 2) {
      const n = (s.reins[q.id] || 0);
      if (n < 2) {
        s.reins[q.id] = n + 1;
        const gap = 2 + Math.floor(Math.random() * 5);
        const pos = Math.min(s.idx + 1 + gap, s.queue.length);
        s.queue.splice(pos, 0, q.id);
      }
    }
    s.done++; s.idx++;
    renderReciteCard(el);
  }));
}

function renderReciteDone(el) {
  const s = App.recite;
  App.recite = null;
  el.innerHTML =
    '<div class="card quiz-score"><div class="big">🎉</div>' +
      '<h3>本轮完成 ' + s.done + ' 张</h3>' +
      '<div class="sub">忘记 ' + s.again + ' 张——10 分钟后会自动重现，别担心。</div>' +
      '<div class="btn-row"><button class="btn" id="again-btn">再来一轮</button>' +
      '<button class="btn ghost" id="back-btn">返回今日</button></div></div>';
  el.querySelector('#again-btn').addEventListener('click', () => startRecite(s.budget));
  el.querySelector('#back-btn').addEventListener('click', () => showView('home'));
}

function renderRecite(el) {
  if (App.recite) return renderReciteCard(el);
  const chips = App.chapters.map((c) =>
    '<button class="chip" data-c="' + esc(c.chapterId) + '">' + esc(c.chapterTitle.replace(/^第[一二三四五六七八]+章\s*/, '')) + '</button>').join('');
  el.innerHTML =
    '<div class="card"><h3>📖 背诵模式</h3>' +
      '<div class="sub">简答 · 论述 · 辨析 · 填空，按艾宾浩斯曲线自动安排复习。先想答案，再点「显示答案」，诚实自评。</div>' +
      '<div class="chips" id="rec-chips" style="margin-top:10px"><button class="chip active" data-c="all">全部</button><button class="chip" data-c="weak">易错卡</button>' + chips + '</div>' +
      '<div class="btn-row">' +
        '<button class="btn" data-b="3">3分钟</button>' +
        '<button class="btn" data-b="5">5分钟</button>' +
        '<button class="btn" data-b="10">10分钟</button>' +
        '<button class="btn ghost" data-b="0">不限时</button>' +
      '</div></div>' +
    '<div class="card"><h3>🎧 听背小技巧</h3>' +
      '<div class="sub">点「🔊 听题」先听题干、回忆答案，再点「显示答案」对照。走路、排队、吃饭都能背。可在「我的」里开关朗读、调语速。</div></div>';
  const setScope = (c) => {
    App.reciteScope = c;
    el.querySelectorAll('#rec-chips .chip').forEach((x) => x.classList.toggle('active', x.dataset.c === c));
  };
  el.querySelector('#rec-chips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (c) setScope(c.dataset.c);
  });
  el.querySelectorAll('[data-b]').forEach((b) => b.addEventListener('click', () => startRecite(+b.dataset.b)));
}

/* ---------- 刷题（选择题自测） ---------- */
function renderQuiz(el) {
  if (App.quiz && App.quiz.idx < App.quiz.list.length) return renderQuizQuestion(el);
  App.quiz = null;
  const chips = App.chapters.map((c) =>
    '<button class="chip" data-c="' + esc(c.chapterId) + '">' + esc(c.chapterTitle.replace(/^第[一二三四五六七八]+章\s*/, '')) + '</button>').join('');
  el.innerHTML =
    '<div class="card"><h3>✍️ 选择题自测</h3>' +
      '<div class="sub">考试没有客观题，这里用来快速自检记忆。错题 10 分钟后重现，直到你答对。</div></div>' +
    '<div class="card"><h3>选择范围</h3><div class="chips" id="q-chips"><button class="chip active" data-c="all">全部</button>' + chips + '</div></div>' +
    '<div class="card"><h3>开始</h3>' +
      '<div class="btn-row"><button class="btn" id="q5">随机 5 题</button><button class="btn" id="q10">随机 10 题</button></div>' +
      '<div class="btn-row"><button class="btn ghost" id="qwrong">错题重练</button></div></div>';

  let sel = 'all';
  el.querySelector('#q-chips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    sel = c.dataset.c;
    el.querySelectorAll('#q-chips .chip').forEach((x) => x.classList.toggle('active', x === c));
  });
  const start = (mode) => {
    let pool = [...App.Q.keys()].filter((id) => {
      const q = App.Q.get(id);
      return QUIZ_TYPES.includes(q.type) && (sel === 'all' || q.chapterId === sel);
    });
    shuffle(pool);
    pool = pool.slice(0, mode);
    if (!pool.length) { toast('该范围没有题目'); return; }
    App.quiz = { list: pool, idx: 0, right: 0, wrong: 0, total: pool.length };
    renderQuizQuestion(el);
  };
  el.querySelector('#q5').addEventListener('click', () => start(5));
  el.querySelector('#q10').addEventListener('click', () => start(10));
  el.querySelector('#qwrong').addEventListener('click', async () => {
    const all = await DB.getAll('srs');
    const wrongIds = all
      .filter((s) => s.lapses > 0 && App.Q.has(s.id) && QUIZ_TYPES.includes(App.Q.get(s.id).type))
      .map((s) => s.id);
    if (!wrongIds.length) { toast('还没有错题，先做一轮吧'); return; }
    shuffle(wrongIds);
    App.quiz = { list: wrongIds.slice(0, 15), idx: 0, right: 0, wrong: 0, total: Math.min(wrongIds.length, 15) };
    renderQuizQuestion(el);
  });
}

function renderQuizQuestion(el) {
  const s = App.quiz;
  if (!s || s.idx >= s.list.length) return renderQuizDone(el);
  const q = App.Q.get(s.list[s.idx]);
  el.innerHTML =
    '<div class="recite-progress"><span>' + (s.idx + 1) + '/' + s.total + '</span>' +
      '<span class="bar"><i style="width:' + Math.round(s.idx / s.total * 100) + '%"></i></span>' +
      '<span>✅' + s.right + ' ❌' + s.wrong + '</span></div>' +
    '<div class="card"><span class="type-badge">' + TYPE_NAMES[q.type] + '</span>' +
      '<span class="chapter-badge">' + esc(q.chapterTitle) + '</span>' +
      '<div class="q-stem">' + esc(q.stem) + '</div><div id="q-body"></div></div>';

  const body = el.querySelector('#q-body');
  const after = async (correct) => {
    if (correct) s.right++; else s.wrong++;
    await SRS.grade(q.id, correct ? 2 : 0);
    body.insertAdjacentHTML('beforeend',
      '<div class="q-explain">' + (correct ? '✅' : '❌') + ' ' + esc(q.explain) + '</div>' +
      '<button class="btn block" id="next" style="margin-top:12px">' + (s.idx + 1 >= s.total ? '查看成绩' : '下一题') + '</button>');
    body.querySelector('#next').addEventListener('click', () => { s.idx++; renderQuizQuestion(el); });
  };

  if (q.type === 'single') {
    body.innerHTML = q.options.map((o, i) => '<button class="opt" data-i="' + i + '">' + esc(o) + '</button>').join('');
    let answered = false;
    body.querySelectorAll('.opt').forEach((btn) => btn.addEventListener('click', () => {
      if (answered) return;
      answered = true;
      const letter = String.fromCharCode(65 + (+btn.dataset.i));
      const correct = q.answer.includes(letter);
      body.querySelectorAll('.opt').forEach((b) => {
        b.disabled = true;
        if (q.answer.includes(String.fromCharCode(65 + (+b.dataset.i)))) b.classList.add('right');
      });
      if (!correct) btn.classList.add('wrong');
      after(correct);
    }));
  } else if (q.type === 'multi') {
    body.innerHTML = q.options.map((o, i) => '<button class="opt" data-i="' + i + '">' + esc(o) + '</button>').join('') +
      '<button class="btn block" id="confirm" style="margin-top:4px">确认</button>';
    let answered = false;
    body.querySelectorAll('.opt').forEach((btn) => btn.addEventListener('click', () => {
      if (answered) return;
      btn.classList.toggle('sel');
    }));
    body.querySelector('#confirm').addEventListener('click', () => {
      if (answered) return;
      answered = true;
      const chosen = [...body.querySelectorAll('.opt.sel')].map((b) => String.fromCharCode(65 + (+b.dataset.i))).sort();
      const correct = JSON.stringify(chosen) === JSON.stringify([...q.answer].sort());
      body.querySelectorAll('.opt').forEach((b) => {
        b.disabled = true;
        if (q.answer.includes(String.fromCharCode(65 + (+b.dataset.i)))) b.classList.add('right');
        else if (b.classList.contains('sel')) b.classList.add('wrong');
      });
      after(correct);
    });
  } else if (q.type === 'judge') {
    body.innerHTML = '<div class="btn-row"><button class="btn green" id="j-true">正确 ✓</button><button class="btn" style="background:var(--red)" id="j-false">错误 ✗</button></div>';
    let answered = false;
    const go = (picked) => {
      if (answered) return;
      answered = true;
      const correct = q.answer[0] === picked;
      body.querySelectorAll('#j-true,#j-false').forEach((b) => (b.disabled = true));
      body.querySelector(q.answer[0] === '对' ? '#j-true' : '#j-false').classList.add('right');
      if (!correct) body.querySelector(picked === '对' ? '#j-true' : '#j-false').classList.add('wrong');
      after(correct);
    };
    body.querySelector('#j-true').addEventListener('click', () => go('对'));
    body.querySelector('#j-false').addEventListener('click', () => go('错'));
  } else { // blank 自评
    body.innerHTML = '<button class="btn block ghost" id="b-show">显示答案</button>';
    let answered = false;
    body.querySelector('#b-show').addEventListener('click', () => {
      if (answered) return;
      answered = true;
      body.innerHTML = answerHtml(q);
      const hear = body.querySelector('#hear-ans');
      if (hear) hear.addEventListener('click', () => speak(q.answer.join('；')));
      body.insertAdjacentHTML('beforeend',
        '<div class="btn-row" style="margin-top:12px"><button class="btn" id="b-right" style="background:var(--green)">我答对了</button><button class="btn" id="b-wrong" style="background:var(--red)">我答错了</button></div>');
      body.querySelector('#b-right').addEventListener('click', async () => { s.right++; await SRS.grade(q.id, 2); s.idx++; renderQuizQuestion(el); });
      body.querySelector('#b-wrong').addEventListener('click', async () => { s.wrong++; await SRS.grade(q.id, 0); s.idx++; renderQuizQuestion(el); });
    });
  }
}

function renderQuizDone(el) {
  const s = App.quiz;
  App.quiz = null;
  const rate = s.total ? Math.round(s.right / s.total * 100) : 0;
  el.innerHTML =
    '<div class="card quiz-score"><div class="big">' + rate + '%</div>' +
      '<h3>答对 ' + s.right + ' / ' + s.total + '</h3>' +
      '<div class="sub">' + (rate >= 80 ? '很棒！继续保持 🔥' : (rate >= 60 ? '不错，错题会自动重现，多刷两轮。' : '别灰心，错题 10 分钟后重现，重点突破它们。')) + '</div>' +
      '<div class="btn-row"><button class="btn" id="q-again">再来一轮</button><button class="btn ghost" id="q-back">返回</button></div></div>';
  el.querySelector('#q-again').addEventListener('click', () => renderQuiz(el));
  el.querySelector('#q-back').addEventListener('click', () => showView('home'));
}

/* ---------- 速览 ---------- */
function clozeText(text, keywords) {
  let t = esc(text);
  for (const k of (keywords || [])) {
    const ek = esc(k);
    if (!ek) continue;
    t = t.split(ek).join('<span class="cloze-blank" data-k="' + ek + '">▢</span>');
  }
  return t;
}

function renderReview(el) {
  if (App.review) return renderPoints(el);
  const list = App.chapters.map((c) => '<button class="chip" data-c="' + esc(c.chapterId) + '">' + esc(c.chapterTitle) + '</button>').join('');
  el.innerHTML =
    '<div class="card"><h3>👀 资料速览</h3>' +
      '<div class="sub">点卡片展开详情（先回忆再点开）；开启「挖空模式」自动展开并隐藏关键词，适合自检。</div>' +
      '<div class="set-item"><span class="lbl">挖空模式</span><button class="switch" id="cloze-sw"></button></div></div>' +
    '<div class="chips" id="rev-chips">' + list + '</div>' +
    '<div id="rev-body"></div>';
  const sw = el.querySelector('#cloze-sw');
  sw.classList.toggle('on', !!App.reviewCloze);
  sw.addEventListener('click', () => {
    App.reviewCloze = !App.reviewCloze;
    sw.classList.toggle('on', !!App.reviewCloze);
    if (App.review) renderPoints(el);
  });
  el.querySelector('#rev-chips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (c) renderPoints(el, c.dataset.c);
  });
}

function renderPoints(el) {
  const chapterId = App.review.chapterId;
  const c = App.chapters.find((x) => x.chapterId === chapterId);
  const points = c ? (c.points || []) : [];
  el.querySelectorAll('#rev-chips .chip').forEach((x) => x.classList.toggle('active', x.dataset.c === chapterId));
  const body = el.querySelector('#rev-body');
  if (!points.length) { body.innerHTML = '<div class="empty"><div class="big">📭</div>本章暂无速览卡</div>'; return; }
  body.innerHTML = points.map((p) => {
    const title = App.reviewCloze ? clozeText(p.title, p.keywords || []) : esc(p.title);
    const detail = App.reviewCloze ? clozeText(p.detail, p.keywords || []) : esc(p.detail);
    const kws = (p.keywords || []).map((k) => '<span class="kw">' + esc(k) + '</span>').join('');
    const openCls = App.reviewCloze ? ' open' : '';
    return '<div class="card point-card' + openCls + '">' +
      '<div class="p-title">' + title + '</div>' +
      '<div class="p-keywords">' + kws + '</div>' +
      '<div class="p-detail">' + detail + '</div>' +
      '<div class="p-hint">▾ 点卡片展开详情</div>' +
      '<div style="margin-top:8px"><button class="voice-btn" data-tts="' + esc(p.title + '。' + p.detail) + '">🔊 听</button></div>' +
      '</div>';
  }).join('');
  body.querySelectorAll('.point-card').forEach((card) => card.addEventListener('click', (e) => {
    if (e.target.closest('.cloze-blank') || e.target.closest('.voice-btn')) return;
    card.classList.toggle('open');
  }));
  body.querySelectorAll('.voice-btn').forEach((b) => b.addEventListener('click', () => speak(b.dataset.tts)));
  body.querySelectorAll('.cloze-blank').forEach((b) => b.addEventListener('click', () => {
    b.classList.add('shown');
    b.textContent = b.dataset.k;
  }));
}

/* ---------- 我的 ---------- */
async function renderMe(el) {
  const todos = await DB.getAll('todo');
  const openTodos = todos.filter((t) => !t.done);
  const days = await Stats.lastDays(14);
  const dots = days.map((d) => '<div class="d ' + (d.count ? 'on' : '') + '">' + d.day + '</div>').join('');
  const streak = await Stats.streak();
  const today = await Stats.todayCount();

  // 章节学习进度
  const seenSet = new Set((await DB.getAll('srs')).map((s) => s.id));
  const prog = App.chapters.map((c) => {
    const ids = (c.questions || []).map((q) => q.id);
    const done = ids.filter((id) => seenSet.has(id)).length;
    const total = ids.length || 1;
    return { title: c.chapterTitle.replace(/^第[一二三四五六七八]+章\s*/, ''), done, total, pct: Math.round(done / total * 100) };
  });
  const totalSeen = App.chapters.reduce((n, c) => n + (c.questions || []).filter((q) => seenSet.has(q.id)).length, 0);
  const progHtml = prog.map((p) =>
    '<div class="pg-row"><span class="lbl">' + esc(p.title) + '</span>' +
    '<span class="bar"><i style="width:' + p.pct + '%"></i></span>' +
    '<span class="num">' + p.done + '/' + p.total + '</span></div>').join('');

  el.innerHTML =
    '<div class="card"><h3>🔥 打卡记录</h3><div class="streak-dots">' + dots + '</div>' +
      '<div class="sub" style="margin-top:8px">连续打卡 ' + streak + ' 天 · 今日已学 ' + today + ' 张</div></div>' +
    '<div class="card"><h3>📈 章节进度（已学 ' + totalSeen + '/' + App.Q.size + '）</h3>' + progHtml + '</div>' +
    '<div class="card"><h3>🗒️ 待办（' + openTodos.length + ' 未完成）</h3>' +
      '<div class="todo-add"><input id="todo-in" placeholder="例如：交高数作业"><button class="btn small" id="todo-add-btn">添加</button></div>' +
      '<div id="todo-list"></div></div>' +
    '<div class="card"><h3>⚙️ 设置</h3>' +
      '<div class="set-item"><span class="lbl">朗读（听背）</span><button class="switch ' + (App.settings.tts ? 'on' : '') + '" id="sw-tts"></button></div>' +
      '<div class="set-item"><span class="lbl">语速 <span class="val" id="rate-val">' + App.settings.rate + '</span></span>' +
        '<input type="range" min="0.6" max="1.4" step="0.05" value="' + App.settings.rate + '" id="tts-rate"></div>' +
      '<div class="set-item"><span class="lbl">考试日期</span><input type="date" id="exam-date" value="' + esc(App.settings.examDate) + '"></div>' +
      '<div class="set-item"><span class="lbl">导入题库 JSON</span><button class="btn small ghost" id="btn-import">选择文件</button></div>' +
      '<div class="set-item"><span class="lbl">导出学习数据备份</span><button class="btn small ghost" id="btn-export">下载</button></div>' +
      '<div class="set-item"><span class="lbl">恢复备份</span><button class="btn small ghost" id="btn-restore">选择文件</button></div>' +
      '<div class="set-item"><span class="lbl">重置学习进度</span><button class="btn small gray" id="btn-reset">重置</button></div>' +
    '</div>' +
    '<div class="card"><div class="sub">碎片学社 v0.4 · 数据全部保存在本机，断网可用 · 为 2026.11.28 思政闭卷而建</div></div>';

  // 待办
  const tl = el.querySelector('#todo-list');
  const renderTodos = async () => {
    const ts = await DB.getAll('todo');
    tl.innerHTML = ts.length === 0
      ? '<div class="sub">还没有待办，加一条吧。</div>'
      : ts.map((t) =>
          '<div class="todo-item ' + (t.done ? 'done' : '') + '">' +
            '<input type="checkbox" data-id="' + t.id + '" ' + (t.done ? 'checked' : '') + '>' +
            '<span class="txt">' + esc(t.text) + '</span>' +
            '<button class="del" data-id="' + t.id + '">✕</button></div>').join('');
    tl.querySelectorAll('input[type=checkbox]').forEach((cb) => cb.addEventListener('change', async () => {
      const t = ts.find((x) => x.id === +cb.dataset.id);
      if (t) { t.done = cb.checked; await DB.put('todo', t); }
      if (cb.checked) toast('完成一件！继续保持 💪');
      renderTodos();
    }));
    tl.querySelectorAll('.del').forEach((b) => b.addEventListener('click', async () => {
      await DB.del('todo', +b.dataset.id);
      renderTodos();
    }));
  };
  await renderTodos();
  const addBtn = el.querySelector('#todo-add-btn');
  const addInp = el.querySelector('#todo-in');
  const addTodo = async () => {
    const val = addInp.value.trim();
    if (!val) return;
    await DB.put('todo', { text: val, done: false, createdAt: Date.now() });
    addInp.value = '';
    renderTodos();
  };
  addBtn.addEventListener('click', addTodo);
  addInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTodo(); });

  // 设置
  el.querySelector('#sw-tts').addEventListener('click', async () => {
    App.settings.tts = !App.settings.tts;
    el.querySelector('#sw-tts').classList.toggle('on', App.settings.tts);
    await saveSettings();
    if (App.settings.tts) { toast('朗读已开启'); speak('朗读已开启'); }
    else { speechSynthesis.cancel(); toast('朗读已关闭'); }
  });
  el.querySelector('#tts-rate').addEventListener('input', async (e) => {
    App.settings.rate = +e.target.value;
    el.querySelector('#rate-val').textContent = App.settings.rate;
    await saveSettings();
  });
  el.querySelector('#exam-date').addEventListener('change', async (e) => {
    App.settings.examDate = e.target.value;
    await saveSettings();
    toast('考试日期已更新');
  });
  const restoreBackup = async (data) => {
    if (!confirm('恢复备份将覆盖当前的学习进度、待办与设置，确定吗？')) return;
    await DB.clear('srs');
    await DB.clear('todo');
    for (const r of data.srs || []) await DB.put('srs', r);
    for (const t of data.todo || []) await DB.put('todo', t);
    if (data.stats) await DB.put('meta', { k: 'stats', days: data.stats.days || {} });
    if (data.settings) await DB.put('meta', { k: 'settings', ...data.settings });
    await loadSettings();
    toast('备份已恢复');
    showView('me');
  };
  const pickFile = (onload) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = () => { const f = inp.files[0]; if (f) onload(f); };
    inp.click();
  };
  el.querySelector('#btn-export').addEventListener('click', async () => {
    const srs = await DB.getAll('srs');
    const todo = await DB.getAll('todo');
    const stats = await DB.get('meta', 'stats');
    const settings = await DB.get('meta', 'settings');
    const data = { type: 'suipian-backup', version: 1, exportedAt: new Date().toISOString(), srs, todo, stats, settings };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '碎片学社备份-' + Stats.dayKey() + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('备份已下载，请妥善保存');
  });
  el.querySelector('#btn-restore').addEventListener('click', () => {
    pickFile(async (f) => {
      let data;
      try { data = JSON.parse(await f.text()); } catch (e) { toast('JSON 解析失败'); return; }
      if (data.type !== 'suipian-backup') { toast('这不是碎片学社的备份文件'); return; }
      await restoreBackup(data);
    });
  });
  el.querySelector('#btn-import').addEventListener('click', () => {
    pickFile(async (f) => {
      let data;
      try { data = JSON.parse(await f.text()); } catch (e) { toast('JSON 解析失败'); return; }
      if (data.type === 'suipian-backup') { await restoreBackup(data); return; }
      const chapters = data.chapters || (data.chapterId ? [data] : null);
      if (!chapters) { toast('格式不对：需要 chapters 数组或单章结构'); return; }
      const cur = (await DB.get('meta', 'customBank')) || { chapters: [] };
      for (const c of chapters) {
        if (!c.chapterId || !Array.isArray(c.questions)) continue;
        const i = cur.chapters.findIndex((x) => x.chapterId === c.chapterId);
        if (i >= 0) cur.chapters[i] = c; else cur.chapters.push(c);
      }
      await DB.put('meta', { k: 'customBank', chapters: cur.chapters });
      await loadBank();
      toast('导入成功，题库共 ' + App.Q.size + ' 题');
      showView('me');
    });
  });
  el.querySelector('#btn-reset').addEventListener('click', async () => {
    if (!confirm('确定清空全部学习进度与打卡记录？题库本身不会删除。')) return;
    await SRS.reset();
    await DB.put('meta', { k: 'stats', days: {} });
    toast('已重置');
    showView('me');
  });
}

/* ---------- 启动 ---------- */
async function boot() {
  try { await DB.open(); } catch (e) { console.warn('indexedDB 不可用', e); }
  await loadSettings();
  await loadBank();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.__installPrompt = e;
  });
  window.addEventListener('appinstalled', () => {
    window.__installPrompt = null;
    toast('安装成功！以后从桌面图标打开 🎉');
  });
  if ('speechSynthesis' in window) {
    speechSynthesis.getVoices(); // 预热语音
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    if (App.view === 'recite' && App.recite) {
      if (!confirm('正在背诵中，退出将中断本轮，确定吗？')) return;
      App.recite = null;
    }
    if (App.view === 'quiz' && App.quiz) {
      if (!confirm('正在刷题中，退出将中断本轮，确定吗？')) return;
      App.quiz = null;
    }
    if (App.view === 'review' && t.dataset.view !== 'review') App.review = null;
    showView(t.dataset.view);
  }));
  showView('home');
}

document.addEventListener('DOMContentLoaded', boot);
