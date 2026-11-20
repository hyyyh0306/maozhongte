/* 艾宾浩斯简化记忆算法（SM-2 变体，适配 15 天冲刺节奏）
   评分：0=忘了(10分钟后重现)  1=模糊(间隔减半，至少12小时)  2=记得(1→2→4→7→14天阶梯) */
const SRS = {
  LADDER: [1, 2, 4, 7, 14], // 天

  async state(id) {
    const s = await DB.get('srs', id);
    return s || { id, reps: 0, good: 0, interval: 0, due: 0, lapses: 0 };
  },

  async save(st) { await DB.put('srs', st); },

  async grade(id, g) {
    const st = await this.state(id);
    const now = Date.now();
    st.reps = (st.reps || 0) + 1;
    if (g === 0) {
      st.lapses = (st.lapses || 0) + 1;
      st.good = 0;
      st.interval = 0;
      st.due = now + 10 * 60 * 1000;               // 10 分钟后
    } else if (g === 1) {
      st.good = 0;
      st.interval = Math.max(0.5, (st.interval || 1) * 0.5);
      st.due = now + st.interval * 86400000;
    } else {
      st.good = (st.good || 0) + 1;
      // 记得：1→2→4→7→14 天阶梯（首次背会 1 天后即复习，贴合冲刺节奏）
      st.interval = SRS.LADDER[Math.min(Math.max(st.good - 1, 0), SRS.LADDER.length - 1)];
      st.due = now + st.interval * 86400000;
    }
    await this.save(st);
    await Stats.bump();
    return st;
  },

  async dueIds(ids) {
    const now = Date.now();
    const due = [];
    for (const id of ids) {
      const s = await this.state(id);
      // 只统计“学过且到期”的卡；从未学过的卡由调用方作为新卡单独处理
      if ((s.reps || 0) > 0 && (s.due || 0) <= now) due.push(id);
    }
    return due;
  },

  async seenIds() {
    const all = await DB.getAll('srs');
    return new Set(all.map((s) => s.id));
  },

  async reset() { await DB.clear('srs'); }
};

/* 打卡统计：meta['stats'] = { days: { 'YYYY-MM-DD': n } } */
const Stats = {
  dayKey(d = new Date()) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  async get() {
    const s = await DB.get('meta', 'stats');
    return s && s.days ? s : { days: {} };
  },
  async bump() {
    const s = await this.get();
    const k = this.dayKey();
    s.days[k] = (s.days[k] || 0) + 1;
    await DB.put('meta', { k: 'stats', days: s.days });
  },
  async todayCount() {
    const s = await this.get();
    return s.days[this.dayKey()] || 0;
  },
  async streak() {
    const s = await this.get();
    let n = 0;
    const d = new Date();
    // 今天没学也允许从昨天起算（宽容一天）
    if (!s.days[this.dayKey(d)]) d.setDate(d.getDate() - 1);
    while (s.days[this.dayKey(d)]) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  },
  async lastDays(n) {
    const s = await this.get();
    const out = [];
    const d = new Date();
    d.setDate(d.getDate() - (n - 1));
    for (let i = 0; i < n; i++) {
      out.push({ key: this.dayKey(d), day: d.getDate(), count: s.days[this.dayKey(d)] || 0 });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }
};
