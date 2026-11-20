/* 选题投票前端 */
(() => {
  'use strict';

  const VOTER_KEY = 'szd_voter_id';
  const POLL_MS = 3500;

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /** 匿名投票人标识：随机 UUID，仅存于 localStorage，不含任何个人信息 */
  function voterId() {
    try {
      let v = localStorage.getItem(VOTER_KEY);
      if (!v || !/^[0-9a-f-]{36}$/i.test(v)) {
        v = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));
        localStorage.setItem(VOTER_KEY, v);
      }
      return v;
    } catch (_) {
      return null;
    }
  }

  const state = {
    voterId: voterId(),
    limit: 14,
    topics: [],
    counts: null,       // 开启“隐藏结果”后为 null
    used: 0,
    myVote: null,
    closed: false,
    hideResults: false,
    isAdmin: false,
    changing: false,   // 已投票但正在修改选择
    selected: null,
    busy: false,
  };

  /* ---------------- 网络 ---------------- */

  function adminToken() {
    try { return sessionStorage.getItem('szd_admin_token') || ''; } catch (_) { return ''; }
  }

  async function api(path, opts = {}) {
    const token = adminToken();
    const res = await fetch(path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(state.voterId ? { 'X-Voter-Id': state.voterId } : {}),
        ...(token ? { 'X-Admin-Token': token } : {}),
        ...(opts.headers || {}),
      },
    });
    let data = {};
    try { data = await res.json(); } catch (_) { /* 空响应 */ }
    if (!res.ok) {
      const err = new Error(data.error || `请求失败（${res.status}）`);
      err.code = data.code;
      throw err;
    }
    return data;
  }

  function applyState(data) {
    state.limit = data.limit ?? state.limit;
    state.topics = data.topics || [];
    state.counts = data.counts || null;
    state.used = data.used ?? 0;
    state.myVote = data.myVote ?? null;
    state.closed = !!data.closed;
    state.hideResults = !!data.hideResults;
    state.isAdmin = !!data.isAdmin;
    if (state.closed) state.changing = false;
  }

  async function load() {
    try {
      applyState(await api('/api/state'));
      render();
    } catch (e) {
      toast('无法连接服务器，请确认终端里的服务仍在运行', 'err');
    }
  }

  async function castVote(topicId) {
    if (state.busy) return;
    state.busy = true;
    try {
      applyState(await api('/api/vote', { method: 'POST', body: JSON.stringify({ topicId }) }));
      toast('投票成功，已计入', 'ok');
      closeModals();
      render();
    } catch (e) {
      toast(e.message, 'err');
      await load();
    } finally {
      state.busy = false;
    }
  }

  /* ---------------- 渲染 ---------------- */

  function render() {
    const hideCounts = !state.counts;
    const used = hideCounts ? state.used : Object.values(state.counts).reduce((a, b) => a + b, 0);
    const limit = state.limit;
    const remaining = Math.max(limit - used, 0);

    $('used').textContent = used;
    $('limit').textContent = limit;
    $('remaining').textContent = state.closed ? '名额已用尽' : `剩余 ${remaining} 票`;
    $('seatsFill').style.width = `${Math.min(100, (used / limit) * 100)}%`;
    $('lockBadge').hidden = !state.closed;
    $('lockBadge').textContent = used < limit ? '已提前截止' : '投票已截止';
    document.querySelector('.counter').classList.toggle('full', used >= limit);
    $('footerTips').hidden = state.closed;

    const voted = state.myVote != null;
    if (!voted) state.changing = false;
    const showVote = !state.closed && (!voted || state.changing);
    $('voteView').hidden = !showVote;
    $('doneView').hidden = !(voted && !state.closed && !state.changing);
    $('closeView').hidden = !state.closed;

    if (showVote) renderTopics();

    if (voted && !state.closed) {
      const t = state.topics.find((x) => x.id === state.myVote);
      $('resultText').textContent = '';
      $('resultText').append('你已投出本组的一票：');
      $('resultText').append(el('span', 'picked', t ? t.title : `主题 ${state.myVote}`));
      const pct = limit ? Math.round((used / limit) * 100) : 0;
      $('resultText').append(`全组已用 ${used}/${limit} 票（${pct}%）。`);
      $('changeNote').textContent = hideCounts
        ? '投票结束后公布结果；名额未满前可修改选择。'
        : '名额未满前可修改选择；投满 14 票后自动锁定。';
    }

    if (state.closed) {
      $('closeText').textContent = '';
      if (hideCounts) {
        $('closeText').append(`投票已截止，得票结果由主持人公布。`);
      } else {
        const ranked = rankedTopics();
        const top = ranked[0];
        $('closeText').append(used >= limit
          ? `本次投票名额已全部用满（${limit}/${limit}），结果已锁定。`
          : `投票已提前截止（共 ${used} 票）。`);
        if (top && top.count > 0) {
          $('closeText').append(el('span', 'picked', `得票最高主题：${top.short}（${top.count} 票）`));
          if (top.count === ranked[1]?.count) {
            $('closeText').append(`出现并列，建议组内协商或由老师裁定。`);
          }
        }
      }
      if (voted) {
        const t = state.topics.find((x) => x.id === state.myVote);
        $('closeText').append(el('p', 'muted', `你投的是：${t ? t.title : '主题 ' + state.myVote}`));
      }
    }
  }

  function rankedTopics() {
    return state.topics
      .map((t) => ({ ...t, count: state.counts[t.id] || 0 }))
      .sort((a, b) => b.count - a.count || a.id - b.id);
  }

  function renderTopics() {
    const hideCounts = !state.counts;
    const counts = state.counts || {};
    const used = Object.values(counts).reduce((a, b) => a + b, 0);
    const max = Math.max(1, ...Object.values(counts));
    const box = $('topics');
    box.textContent = '';

    for (const t of state.topics) {
      const count = counts[t.id] || 0;
      const card = el('article', 'topic');
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `投票给 ${t.title}`);
      card.dataset.id = t.id;

      if (state.myVote === t.id) card.classList.add('selected');
      if (count > 0 && count === max) card.classList.add('leading');

      const head = el('div', 'topic-head');
      head.append(el('span', 'topic-no', String(t.id)));
      head.append(el('h3', 'topic-title', t.title));
      head.append(el('span', 'topic-cat', t.shortCat || t.cat));
      card.append(el('span', 'crown', '领跑'));

      card.append(head);
      card.append(el('p', 'topic-desc', t.desc));

      const elems = el('div', 'topic-elems');
      (t.elems || []).forEach((e) => elems.append(el('span', 'elem', e)));
      card.append(elems);

      const foot = el('div', 'topic-foot');
      if (!hideCounts) {
        const bar = el('div', 'bar');
        const fill = el('i');
        fill.style.width = `${(count / max) * 100}%`;
        bar.append(fill);
        foot.append(bar);
        const nums = el('span', 'foot-nums');
        nums.append(el('b', '', String(count)), document.createTextNode(` 票 · ${Math.round((count / (used || 1)) * 100)}%`));
        foot.append(nums);
      } else {
        foot.append(el('span', 'foot-nums', '投票结束后公布得票'));
      }
      card.append(foot);
      card.append(el('span', 'my-tag', '已选'));
      if (state.myVote === t.id) card.append(el('span', 'my-tag', '我的选择'));

      const pick = () => selectTopic(t);
      card.addEventListener('click', pick);
      card.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); }
      });

      box.append(card);
    }
  }

  function selectTopic(t) {
    if (state.busy) return;
    if (state.closed) { toast('投票已截止', 'err'); return; }
    if (state.myVote === t.id) {
      state.changing = false;      // 点了自己原来的选项：视为放弃修改
      render();
      toast('你本来就投的是这个主题');
      return;
    }
    state.selected = t.id;
    if (state.myVote != null) {
      $('confirmTitle').textContent = '确认修改为这个主题？';
      $('confirmOk').textContent = '确认修改';
    } else {
      $('confirmTitle').textContent = '确认提交？';
      $('confirmOk').textContent = '确认投票';
    }
    renderTopics();
    $('confirmTopic').textContent = `主题 ${t.id} · ${t.title}`;
    openModal('confirmModal');
  }

  /* ---------------- 弹窗 ---------------- */

  function openModal(id) {
    const m = $(id);
    m.hidden = false;
    const first = m.querySelector('input, button.primary-btn, button.ghost-btn');
    if (first) setTimeout(() => first.focus(), 30);
  }

  function closeModals() {
    ['confirmModal', 'adminModal'].forEach((id) => { $(id).hidden = true; });
    state.selected = null;
  }
  /* ---------------- Toast ---------------- */

  let toastTimer = null;
  function toast(msg, type) {
    const t = $('toast');
    t.textContent = msg;
    t.className = `toast show ${type || ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200);
  }

  /* ---------------- 管理 ---------------- */

  async function refreshAdmin() {
    if (!state.isAdmin) return;
    try {
      const d = await api('/api/admin/votes');
      const used = d.votes.length;
      const stats = $('adminStats');
      stats.textContent = '';
      const mk = (val, label) => {
        const s = el('div', 'stat');
        s.append(el('b', '', String(val)));
        s.append(el('span', '', label));
        return s;
      };
      stats.append(mk(used, '已投票'), mk(Math.max(d.limit - used, 0), '剩余名额'), mk(d.limit, '总名额'));

      const list = $('voteLog');
      list.textContent = '';
      if (d.votes.length === 0) {
        const li = el('li', 'empty', '暂无投票记录');
        list.append(li);
      } else {
        d.votes.forEach((v) => {
          const li = el('li');
          li.append(el('span', '', `第 ${v.seq} 票 · 主题 ${v.topicId}`));
          li.append(el('span', 'meta', `${v.time} · ${v.voter}`));
          list.append(li);
        });
      }
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function doReset() {
    const ans = prompt('此操作会删除全部投票记录，重新开始。\n请输入“清空”两个字确认：');
    if (ans !== '清空') { if (ans != null) toast('未清空：确认文字不匹配', 'err'); return; }
    try {
      applyState(await api('/api/admin/reset', { method: 'POST', body: '{}' }));
      toast('已清空全部投票', 'ok');
      closeModals();
      render();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function doLogin(pwd) {
    try {
      const data = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: pwd }) });
      try { sessionStorage.setItem('szd_admin_token', data.token); } catch (_) { /* 无痕模式 */ }
      applyState(await api('/api/state'));
      $('adminLogin').hidden = true;
      $('adminAuthed').hidden = false;
      $('hideResultsChk').checked = state.hideResults;
      $('closeBtn').disabled = state.closed;
      render();
      await refreshAdmin();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function toggleHide() {
    try {
      applyState(await api('/api/admin/toggle-results', { method: 'POST', body: '{}' }));
      $('hideResultsChk').checked = state.hideResults;
      toast(state.hideResults ? '已隐藏实时票数' : '已恢复显示实时票数', 'ok');
      render();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function doClose() {
    const used = state.used;
    if (!confirm(`确定现在截止投票吗？当前已投 ${used} 票。截止后无法再投票或修改。`)) return;
    if (prompt('请输入“截止”两个字确认：') !== '截止') { toast('未截止：确认文字不匹配', 'err'); return; }
    try {
      applyState(await api('/api/admin/close', { method: 'POST', body: '{}' }));
      toast('投票已截止，结果已公布', 'ok');
      closeModals();
      render();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  /* ---------------- 事件绑定 ---------------- */

  function bind() {
    const reveal = () => {
      if (!state.counts) {
        toast('主持人已设置为投票结束后公布结果，暂不显示票数', 'err');
        return false;
      }
      return true;
    };

    $('confirmCancel').addEventListener('click', () => { state.selected = null; closeModals(); render(); });
    $('confirmOk').addEventListener('click', () => { if (state.selected != null) castVote(state.selected); });

    // 仅用于现场“投影大屏看得票”：不改变服务端设置
    $('resultBtn').addEventListener('click', () => {
      if (!state.counts) {
        toast(state.hideResults ? '主持人已设置为投票结束后公布，暂不显示票数' : '数据加载中…', 'err');
        return;
      }
      state.changing = !state.changing;
      render();
    });

    $('changeBtn').addEventListener('click', () => {
      state.changing = true;
      render();
      toast('点选新主题即替换原票；按 Esc 或点原主题保持原选择');
    });

    $('peekBtn').addEventListener('click', () => {
      if (!reveal()) return;
      state.changing = true;
      render();
      toast('点选卡片可修改；不点则保持原票');
    });

    $('closePeek').addEventListener('click', () => {
      if (!reveal()) return;
      // 截止后只读展示：把结果区隐藏后直接渲染卡片（选择会被服务端拒绝）
      $('closeView').hidden = true;
      renderTopics();
    });

    $('adminBtn').addEventListener('click', () => {
      if (state.isAdmin) {
        $('adminLogin').hidden = true;
        $('adminAuthed').hidden = false;
        $('hideResultsChk').checked = state.hideResults;
        $('closeBtn').disabled = state.closed;
        refreshAdmin();
      } else {
        $('adminLogin').hidden = false;
        $('adminAuthed').hidden = true;
        setTimeout(() => $('adminPwd').focus(), 30);
      }
      openModal('adminModal');
    });
    $('adminCancel').addEventListener('click', closeModals);
    $('adminClose').addEventListener('click', closeModals);
    $('adminForm').addEventListener('submit', (ev) => {
      ev.preventDefault();
      doLogin($('adminPwd').value);
      $('adminPwd').value = '';
    });
    $('resetBtn').addEventListener('click', doReset);
    $('closeBtn').addEventListener('click', doClose);
    $('hideResultsChk').addEventListener('change', toggleHide);

    document.querySelectorAll('.modal').forEach((m) => {
      m.addEventListener('click', (ev) => {
        if (ev.target === m && m.id === 'confirmModal') {
          state.selected = null;
          closeModals();
          render();
        }
      });
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        state.selected = null;
        closeModals();
        render();
      }
    });

    // 标签页切回前台立即刷新
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { load(); if (state.isAdmin) refreshAdmin(); }
    });
  }

  /* ---------------- 启动 ---------------- */

  bind();
  load();
  // 截止后关闭自动刷新，让“看得票情况”的只读展示保持打开
  setInterval(() => {
    if (document.hidden || state.closed) return;
    load();
    if (state.isAdmin && !$('adminModal').hidden) refreshAdmin();
  }, POLL_MS);
})();
