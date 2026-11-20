#!/usr/bin/env node
'use strict';
/**
 * 《思想道德与法治》实践教学选题投票 · 服务器
 *
 * - 全局只允许 14 人投票，每人（每台设备）1 票，选 1 个主题
 * - 本地运行：零第三方依赖，票数存 data/votes.json
 * - 云端运行（Render 等）：自动读取 PORT；若配置 REDIS_URL（Key Value），
 *   票数会写进外部存储，实例休眠重启后也不会丢
 * - 数据没有落到持久化存储时，禁止“清空”，避免把已投的票丢掉
 *
 * 用法：  node server.js [--port 8848] [--limit 14] [--open]
 */

const http = require('node:http');
const net = require('node:net');
const tls = require('node:tls');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { exec, execFile } = require('node:child_process');

/* ================= 主题（提炼自课程实践教学方案“一、实践教学内容”） ================= */

const TOPICS = [
  {
    id: 1,
    title: '匠心寻访：我身边的“工精神”',
    cat: '职业精神 · 访谈调研',
    shortCat: '职业精神',
    short: '主题一 工精神',
    desc: '深入校企合作单位、实习基地或老家，访谈一位（或一组）优秀技能人才 / 大国工匠，结合其成长经历分析“业、精、专注、创新”的工精神对个人成就和职业发展的价值。',
    elems: ['访谈提纲设计', '人物深度访谈', '工精神具体体现', '个人感悟'],
  },
  {
    id: 2,
    title: '高职学生职业价值观与就业观调查',
    cat: '价值观 · 问卷调研',
    shortCat: '价值观调查',
    short: '主题二 职业价值观',
    desc: '面向本校或本院系不同年级学生发放问卷，了解大家对“理想工作”的期待（薪资、行业前景、工作稳定性、个人兴趣、社交圈等），分析当前高职学生职业价值观的现状与偏向，并提出引导建议。',
    elems: ['问卷设计', '数据收集与分析', '价值观现状总结', '对策建议'],
  },
  {
    id: 3,
    title: '大学生网络行为与网络道德规范',
    cat: '网络文明 · 案例分析',
    shortCat: '网络文明',
    short: '主题三 网络道德',
    desc: '观察大学生在网络公共空间（知乎、B 站、微博、校园论坛等）的言行，通过典型案例收集与观察分析，研究网络传播与网络舆论现象，梳理其道德规范与法律边界。',
    elems: ['网络现象观察', '典型案例分析', '道德与法律分析', '文明公约撰写'],
  },
  {
    id: 4,
    title: '校园公共场所文明行为观察',
    cat: '校园文明 · 实地观察',
    shortCat: '校园文明',
    short: '主题四 校园文明',
    desc: '选取教学楼、食堂、图书馆或某个公共社交场所等具体公共空间，进行为期一段时间的定点观察，记录占座、设施维护、人际关系等文明与不文明现象，从“道德自律”与“规则约束”两个角度分析成因并提出改进方案。',
    elems: ['实地观察记录', '现象归类与成因', '改进方案'],
  },
  {
    id: 5,
    title: '地方法治实践场馆参观研学',
    cat: '法治实践 · 实地研学',
    shortCat: '法治实践',
    short: '主题五 法治研学',
    desc: '小组集体参观本地与法治相关的场馆或机构（法院、检察院、法治宣传教育基地、律师事务所、公共法律服务中心等），提前做好知识准备，记录参观过程，思考法治如何具体保障社会运行和个人权利，形成研学报告。',
    elems: ['前期知识准备', '参观过程记录', '法治实践感悟', '研学报告'],
  },
  {
    id: 6,
    title: '家乡 / 身边的高质量发展变迁',
    cat: '中国故事 · 史料数据',
    shortCat: '发展变迁',
    short: '主题六 中国故事',
    desc: '通过新旧对比、数据查阅、走访等方式，调研家乡或学校所在地近十年的变化（经济发展、城乡建设、生态环境、文化生活等某一具体方面），用鲜活的例子和直观的数据讲好中国式现代化在身边的生动实践。',
    elems: ['史料收集', '数据收集', '新旧对比分析', '讲故事化呈现'],
  },
  {
    id: 7,
    title: '对话榜样：优秀党员与身边榜样',
    cat: '理想信念 · 榜样访谈',
    shortCat: '理想信念',
    short: '主题七 理想榜样',
    desc: '访谈一位或几位身边优秀的学生党员、国家奖学金获得者、参军入伍者或扎根基层的优秀校友，了解他们的生涯规划、奋斗历程和关键时刻的选择，理解个人理想如何与时代发展同频共振。',
    elems: ['对象选定', '生涯与奋斗历程访谈', '关键时刻选择', '思想内核总结'],
  },
  {
    id: 8,
    title: '校园碳足迹调查与减排方案设计',
    cat: '生态文明 · 数据测算',
    shortCat: '生态文明',
    short: '主题八 碳足迹',
    desc: '调研校内碳排放源（一次性用品使用、用电、出行方式等），通过问卷调查和实地计量测算某一方面的碳排放，并基于调研结果设计一份具有可行性的校园减排方案。',
    elems: ['排放源分析', '数据测算', '方案设计', '可行性论证'],
  },
  {
    id: 9,
    title: '大学生考试诚信与学习生活状况调查',
    cat: '诚信素养 · 问卷调研',
    shortCat: '诚信素养',
    short: '主题九 诚信调查',
    desc: '通过匿名和具名相结合的问卷形式，调查大学生在学业（作业、考试）、经济（助学使用、网络借贷等）、生活等方面的诚信状况，分析存在的问题及其原因，并提出加强校园诚信文化建设的建议。',
    elems: ['匿名 / 具名问卷', '诚信现状分析', '问题与原因', '诚信文化建设建议'],
  },
  {
    id: 10,
    title: '“Z 世代”消费观与理财观调查',
    cat: '消费观念 · 问卷调研',
    shortCat: '消费观念',
    short: '主题十 消费观',
    desc: '面向大学生这一“Z 世代”群体，设计问卷了解其消费习惯（购物偏好、消费渠道、影响因素等）、理财方式（储蓄、基金、超前消费等）和财富观，分析其特点与成因，引导树立理性的消费观和正确的财富观。',
    elems: ['消费行为调查', '理财方式调查', '成因分析', '理性引导建议'],
  },
];

const TOPIC_IDS = new Set(TOPICS.map((t) => t.id));

/* ================= 参数 ================= */

function parseArgs(argv) {
  const envPort = Number(process.env.PORT);      // Render 等平台通过 PORT 指定端口
  const out = {
    port: Number.isInteger(envPort) && envPort > 0 ? envPort : 8848,
    limit: 14,
    host: '0.0.0.0',
    open: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => (argv[++i] || '').trim();
    if (a === '--port') out.port = Number(next());
    else if (a.startsWith('--port=')) out.port = Number(a.slice(7));
    else if (a === '--limit') out.limit = Number(next());
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice(8));
    else if (a === '--host') out.host = next();
    else if (a === '--open') out.open = true;
    else if (a === '--no-open') out.open = false;
  }
  if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535) out.port = 8848;
  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 999) out.limit = 14;
  if (process.env.VOTE_LIMIT && Number.isInteger(Number(process.env.VOTE_LIMIT))) {
    const n = Number(process.env.VOTE_LIMIT);
    if (n > 0 && n <= 999) out.limit = n;
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));
const LIMIT = ARGS.limit;
const PORT = ARGS.port;
const HOST = ARGS.host;
const RUNNING_IN_CLOUD = !!(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.VOTE_DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'votes.json');
const VOTER_RE = /^[A-Za-z0-9-]{8,64}$/;

/* ================= 管理密码 ================= */

function loadAdminPassword() {
  if (process.env.VOTE_ADMIN_PASSWORD) return process.env.VOTE_ADMIN_PASSWORD;
  const file = path.join(DATA_DIR, 'admin-password.txt');
  try {
    const p = fs.readFileSync(file, 'utf8').trim();
    if (p) return p;
  } catch (_) { /* 首次运行 */ }
  const p = String(crypto.randomInt(100000, 1000000));
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, p + '\n', 'utf8');
  } catch (_) { /* 临时目录不可写时退回内存密码 */ }
  return p;
}

const ADMIN_PASSWORD = loadAdminPassword();
/** 管理密码等敏感信息不进日志：用它的 SHA-256 作为管理 token（重启后仍有效） */
const ADMIN_TOKEN = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex');

/* ================= 数据 ================= */

function emptyData() {
  return { votes: {}, order: [], closed: false, closedAt: null, hideResults: false };
}

function normalize(raw) {
  const votes = {};
  for (const [voter, v] of Object.entries((raw && raw.votes) || {})) {
    if (VOTER_RE.test(voter) && v && TOPIC_IDS.has(v.topicId)) {
      votes[voter] = { topicId: v.topicId, at: Number(v.at) || Date.now() };
    }
  }
  return {
    votes,
    order: Array.isArray(raw && raw.order) ? raw.order.filter((v) => votes[v]) : Object.keys(votes),
    closed: !!(raw && raw.closed),
    closedAt: (raw && raw.closedAt) || null,
    hideResults: !!(raw && raw.hideResults),
  };
}

function loadData() {
  try {
    return normalize(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  } catch (_) {
    return emptyData();
  }
}

let DB = loadData();
let writeChain = Promise.resolve();
let localDirty = false;          // 本地有新票还没写进外部存储

/* ---------------- 外部持久存储（Redis / Valkey 协议，兼容 Render Key Value） ---------------- */

const REDIS_URL = process.env.REDIS_URL || process.env.KEY_VALUE_URL || '';
const SNAPSHOT_KEY = process.env.VOTE_SNAPSHOT_KEY || 'szd-vote:state';
const GUARD_KEY = `${SNAPSHOT_KEY}:flag`;

/** 极小 RESP 客户端：只用到 AUTH / PING / GET / SET，够存投票快照即可，不引第三方库 */
function createRedisClient(redisUrl) {
  const url = new URL(redisUrl);
  const useTls = url.protocol === 'rediss:';
  const host = url.hostname;
  const port = Number(url.port) || 6379;
  const password = url.password ? decodeURIComponent(url.password) : '';
  const username = url.username ? decodeURIComponent(url.username) : '';
  const dbIndex = url.pathname && url.pathname.length > 1 ? Number(url.pathname.slice(1)) || 0 : 0;
  let socket = null;
  let buffer = Buffer.alloc(0);
  let queue = [];
  let connecting = null;

  function encode(args) {
    const parts = [`*${args.length}\r\n`];
    for (const a of args) {
      const s = String(a);
      parts.push(`$${Buffer.byteLength(s)}\r\n${s}\r\n`);
    }
    return Buffer.from(parts.join(''), 'utf8');
  }

  function parse(buf) {
    const results = [];
    let pos = 0;
    while (pos < buf.length) {
      const start = pos;
      const lineEnd = buf.indexOf('\r\n', pos);
      if (lineEnd === -1) break;
      const type = String.fromCharCode(buf[pos]);
      const line = buf.slice(pos + 1, lineEnd).toString('utf8');
      pos = lineEnd + 2;
      if (type === '+' || type === '-') {
        results.push({ type, value: line });
      } else if (type === ':') {
        results.push({ type, value: Number(line) });
      } else if (type === '$') {
        const len = Number(line);
        if (len === -1) { results.push({ type: 'bulk', value: null }); continue; }
        if (pos + len + 2 > buf.length) { pos = start; break; }
        results.push({ type: 'bulk', value: buf.slice(pos, pos + len).toString('utf8') });
        pos += len + 2;
      } else if (type === '*') {
        const count = Number(line);
        const items = [];
        let ok = true;
        for (let k = 0; k < count; k++) {
          if (pos >= buf.length) { ok = false; break; }
          const t = String.fromCharCode(buf[pos]);
          const e = buf.indexOf('\r\n', pos);
          if (e === -1) { ok = false; break; }
          const l = buf.slice(pos + 1, e).toString('utf8');
          pos = e + 2;
          if (t === '$') {
            const len = Number(l);
            if (len === -1) { items.push(null); continue; }
            if (pos + len + 2 > buf.length) { ok = false; break; }
            items.push(buf.slice(pos, pos + len).toString('utf8'));
            pos += len + 2;
          } else {
            items.push(l);
          }
        }
        if (!ok) { pos = start; break; }
        results.push({ type: 'array', value: items });
      } else {
        pos = start;
        break;
      }
    }
    return { results, rest: buf.slice(pos) };
  }

  function failAll(err) {
    const pending = queue;
    queue = [];
    for (const p of pending) p.reject(err);
  }

  function connect() {
    if (connecting) return connecting;
    connecting = new Promise((resolve, reject) => {
      const sock = useTls ? tls.connect({ host, port, servername: host }) : net.connect({ host, port, timeout: 8000 });
      socket = sock;

      function onData(chunk) {
        buffer = Buffer.concat([buffer, chunk]);
        const { results, rest } = parse(buffer);
        buffer = rest;
        for (const r of results) {
          const p = queue.shift();
          if (!p) continue;
          if (r.type === '-') p.reject(new Error(r.value));
          else p.resolve(r.value);
        }
      }
      function onDrop(err) {
        if (socket !== sock) return;
        failAll(err || new Error('Redis 连接已关闭'));
        socket = null;
        connecting = null;
      }

      sock.on('timeout', () => sock.destroy(new Error('连接 Redis 超时')));
      sock.once('error', (e) => {
        socket = null;
        connecting = null;
        reject(e);
      });
      sock.once(useTls ? 'secureConnect' : 'connect', async () => {
        // 关键：先挂上数据监听，再发 AUTH / SELECT / PING，否则应答永远不会被读到
        sock.on('data', onData);
        sock.on('error', onDrop);
        sock.on('close', () => onDrop());
        try {
          if (password) await command('AUTH', username ? [username, password] : [password]);
          if (dbIndex) await command('SELECT', [dbIndex]);
          const pong = await command('PING');
          if (pong !== 'PONG') throw new Error(`Redis PING 异常：${pong}`);
          sock.setTimeout(0);
          resolve();
        } catch (e) {
          sock.destroy();
          socket = null;
          connecting = null;
          reject(e);
        }
      });
    });
    return connecting;
  }

  async function command(name, args = []) {
    if (!socket) await connect();
    return new Promise((resolve, reject) => {
      queue.push({ resolve, reject });
      socket.write(encode([name, ...args]));
    });
  }

  return {
    async get(key) { const v = await command('GET', [key]); return v == null ? null : String(v); },
    async set(key, value) { await command('SET', [key, value]); },
    close() { if (socket) socket.destroy(); },
  };
}

let kv = null;
let storageMode = 'file';        // 'file' | 'kv' | 'memory'
let durable = false;             // 数据是否落到了重启后仍然存在的存储里
let storageInitFailed = null;    // 用于暴露给 /api/health，便于排查云端配置

async function initStorage() {
  if (REDIS_URL) {
    try {
      kv = createRedisClient(REDIS_URL);
      const raw = await kv.get(SNAPSHOT_KEY);
      if (raw) DB = normalize(JSON.parse(raw));
      await kv.set(SNAPSHOT_KEY, JSON.stringify(snapshotObject()));
      await kv.set(GUARD_KEY, '1');
      storageMode = 'kv';
      durable = true;
      console.log('[storage] 已使用外部持久存储（Key Value），休眠重启后票数不会丢');
    } catch (e) {
      console.error('[storage] 连接外部存储失败：', e.message);
      storageInitFailed = e.message;
      kv = null;
    }
  }
  if (!kv) {
    if (RUNNING_IN_CLOUD) {
      // 云端例程的文件系统是临时的：能写，但重启 / 休眠后会被清空。
      // 这时绝不能悄悄把票存到临时盘 —— 两次投票间隔久一点就会丢票，所以直接退出让部署失败并暴露问题。
      storageMode = 'memory';
      durable = false;
      console.error('[storage] 未配置可用的 REDIS_URL，票数无法持久化。');
      console.error('          云端免费实例空闲会休眠、重启后临时文件会清空，继续运行会丢票，因此停止启动。');
      console.error('          请在 render.yaml 里接入 Key Value（REDIS_URL），或设置环境变量后重新部署。');
      process.exit(1);
    }
    storageMode = 'file';
    durable = true;
  }
}

function snapshotObject() {
  return {
    limit: LIMIT,
    votes: DB.votes,
    order: DB.order,
    closed: DB.closed,
    closedAt: DB.closedAt,
    hideResults: DB.hideResults,
    updatedAt: new Date().toISOString(),
  };
}

function persist() {
  const snapshot = JSON.stringify(snapshotObject(), null, 2);
  localDirty = true;
  writeChain = writeChain.then(async () => {
    if (kv) {
      await kv.set(SNAPSHOT_KEY, snapshot);
      const latest = JSON.stringify(snapshotObject(), null, 2);
      if (latest !== snapshot) await kv.set(SNAPSHOT_KEY, latest);  // 写入期间又有新票，补写最新快照
      localDirty = false;
      return;
    }
    // 串行写入：先写临时文件再改名，避免崩溃留下半个文件
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    await fs.promises.writeFile(tmp, snapshot, 'utf8');
    await fs.promises.rename(tmp, DATA_FILE);
  }).catch((e) => console.error('[warn] 保存失败：', e.message));
  return writeChain;
}

/**
 * 多实例 / 休眠重启的场景下，票数是最重要的状态：读票前先从外部存储同步。
 * 如果本地还有没写进外部存储的票（localDirty），先落盘再同步，绝不用旧快照覆盖新票。
 */
let lastSync = 0;
let syncChain = Promise.resolve();
function syncFresh(force) {
  if (!kv) return Promise.resolve();
  // 排队执行：并发请求共用一次同步结果，且不会交错读到彼此的半路状态
  syncChain = syncChain.then(async () => {
    await writeChain;
    if (localDirty) await persist();
    const now = Date.now();
    if (!force && now - lastSync < 1500) return;
    lastSync = now;
    try {
      const raw = await kv.get(SNAPSHOT_KEY);
      if (raw) DB = normalize(JSON.parse(raw));
    } catch (e) {
      console.error('[warn] 同步外部存储失败：', e.message);
    }
  });
  return syncChain;
}

function usedCount() {
  return Object.keys(DB.votes).length;
}

function counts() {
  const c = {};
  for (const t of TOPICS) c[t.id] = 0;
  for (const v of Object.values(DB.votes)) c[v.topicId] += 1;
  return c;
}

/** 管理 token = SHA-256(密码)，重部署后仍有效；服务重启不会泄露密码到日志里 */
function isAdmin(req) {
  const token = String(req.headers['x-admin-token'] || '').toLowerCase();
  if (!token) return false;
  const a = Buffer.from(token, 'hex');
  const b = Buffer.from(ADMIN_TOKEN, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readVoter(req) {
  const v = String(req.headers['x-voter-id'] || '');
  return VOTER_RE.test(v) ? v : null;
}

function fmtTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* ================= HTTP 工具 ================= */

function send(res, status, body, headers = {}) {
  const isObj = body && typeof body === 'object';
  const payload = isObj ? JSON.stringify(body) : String(body ?? '');
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 16 * 1024) { req.destroy(); resolve(null); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (_) { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) {
      // 前端路由兜底到 index.html
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) return send(res, 404, 'Not Found');
        send(res, 200, html, { 'Content-Type': MIME['.html'] });
      });
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(buf);
  });
}

/* ================= 路由 ================= */

function publicState(req) {
  const voter = readVoter(req);
  const admin = isAdmin(req);
  const mine = voter ? DB.votes[voter] : null;
  return {
    limit: LIMIT,
    used: usedCount(),
    closed: DB.closed,
    closedAt: DB.closedAt,
    hideResults: DB.hideResults,
    topics: TOPICS,
    // 开启“隐藏结果”后，非管理员只能看到自己是否已投，看不到具体票数
    counts: DB.hideResults && !admin ? null : counts(),
    myVote: mine ? mine.topicId : null,
    isAdmin: admin,
    durable,
    serverTime: fmtTime(Date.now()),
  };
}

async function handleApi(req, res, pathname) {
  const method = req.method;

  if (pathname === '/api/health' && method === 'GET') {
    return send(res, 200, { ok: true, storage: storageMode, durable });
  }

  if (pathname === '/api/state' && method === 'GET') {
    await syncFresh(false);
    return send(res, 200, publicState(req));
  }

  if (pathname === '/api/vote' && method === 'POST') {
    const voter = readVoter(req);
    if (!voter) return send(res, 400, { error: '缺少投票人标识，请刷新页面后重试', code: 'NO_VOTER' });

    const body = await readJson(req);
    const topicId = body && Number(body.topicId);
    if (!Number.isInteger(topicId) || !TOPIC_IDS.has(topicId)) {
      return send(res, 400, { error: '请选择有效的主题（1–10）', code: 'BAD_TOPIC' });
    }

    await syncFresh(true);   // 先把外部存储里的最新票数拉下来，再判断名额

    // 下面这部分在单线程事件循环里同步完成：并发请求也不会超卖 14 份名额
    const existing = DB.votes[voter];
    if (existing) {
      if (existing.topicId === topicId) {
        return send(res, 200, { ok: true, changed: false, ...publicState(req) });
      }
      if (DB.closed) {
        return send(res, 409, { error: `投票已截止（已用 ${usedCount()}/${LIMIT} 票），不能再修改选择`, code: 'CLOSED' });
      }
      existing.topicId = topicId;
      existing.at = Date.now();
      await persist();
      return send(res, 200, { ok: true, changed: true, ...publicState(req) });
    }

    if (DB.closed) {
      return send(res, 409, { error: `投票已截止：${LIMIT} 个名额已全部用满`, code: 'CLOSED' });
    }
    if (usedCount() >= LIMIT) {
      DB.closed = true;
      DB.closedAt = Date.now();
      await persist();
      return send(res, 409, { error: `投票已截止：${LIMIT} 个名额已全部用满`, code: 'CLOSED' });
    }

    DB.votes[voter] = { topicId, at: Date.now() };
    DB.order.push(voter);
    const used = usedCount();
    if (used >= LIMIT) {
      DB.closed = true;
      DB.closedAt = Date.now();
    }
    await persist();
    return send(res, 200, { ok: true, seq: used, ...publicState(req) });
  }

  if (pathname === '/api/admin/login' && method === 'POST') {
    const body = await readJson(req);
    const pwd = String((body && body.password) || '');
    const a = Buffer.from(crypto.createHash('sha256').update(pwd).digest());
    const b = Buffer.from(crypto.createHash('sha256').update(ADMIN_PASSWORD).digest());
    if (!crypto.timingSafeEqual(a, b)) {
      return send(res, 401, { error: '密码错误', code: 'BAD_PASSWORD' });
    }
    // 前端把此 token 存在 sessionStorage；重部署后密码不变，token 依旧有效
    return send(res, 200, { ok: true, token: ADMIN_TOKEN, ...publicState({ ...req, headers: { ...req.headers, 'x-admin-token': ADMIN_TOKEN } }) });
  }

  if (!isAdmin(req)) {
    return send(res, 403, { error: '需要管理员权限', code: 'FORBIDDEN' });
  }

  await syncFresh(true);

  if (pathname === '/api/admin/votes' && method === 'GET') {
    const seqOf = new Map();
    let i = 0;
    for (const v of DB.order) if (DB.votes[v]) seqOf.set(v, ++i);
    for (const v of Object.keys(DB.votes)) if (!seqOf.has(v)) seqOf.set(v, ++i);
    const votes = [...seqOf.entries()]
      .map(([voter, seq]) => ({ seq, voter: voter.slice(0, 8), topicId: DB.votes[voter].topicId, time: fmtTime(DB.votes[voter].at) }))
      .sort((x, y) => x.seq - y.seq);
    return send(res, 200, { limit: LIMIT, votes, counts: counts() });
  }

  if (pathname === '/api/admin/reset' && method === 'POST') {
    if (!durable) {
      return send(res, 409, {
        error: '当前票数保存在临时文件里（实例重启会清空），为避免丢失已投的票，已禁用“清空”。需要重置请重新部署服务。',
        code: 'NOT_DURABLE',
      });
    }
    DB = emptyData();          // 清空即重新开放投票
    await persist();
    return send(res, 200, { ok: true, ...publicState(req) });
  }

  if (pathname === '/api/admin/toggle-results' && method === 'POST') {
    DB.hideResults = !DB.hideResults;
    await persist();
    return send(res, 200, { ok: true, hideResults: DB.hideResults, ...publicState(req) });
  }

  if (pathname === '/api/admin/close' && method === 'POST') {
    if (!DB.closed) {
      DB.closed = true;
      DB.closedAt = Date.now();
      await persist();
    }
    return send(res, 200, { ok: true, ...publicState(req) });
  }

  return send(res, 404, { error: '接口不存在', code: 'NOT_FOUND' });
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (_) {
    return send(res, 400, 'Bad Request');
  }

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname).catch((e) => {
      console.error('[error]', e);
      if (!res.headersSent) send(res, 500, { error: '服务器内部错误，请查看终端日志', code: 'INTERNAL' });
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
  serveStatic(req, res, pathname);
});

/* ================= 启动 ================= */

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal && !n.address.startsWith('127.')) out.push(n.address);
    }
  }
  return out;
}

function openBrowser(url) {
  if (process.platform === 'win32') exec(`start "" "${url}"`, { windowsHide: true, shell: 'cmd.exe' });
  else if (process.platform === 'darwin') execFile('open', [url]);
  else execFile('xdg-open', [url]);
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n[错误] 端口 ${PORT} 已被占用。换一个端口，例如：node server.js --port 8899\n`);
  } else if (e.code === 'EACCES') {
    console.error(`\n[错误] 没有权限监听端口 ${PORT}，请换一个大于 1024 的端口。\n`);
  } else {
    console.error('[错误]', e.message);
  }
  process.exit(1);
});

function printBanner() {
  const publicUrl = process.env.RENDER_EXTERNAL_URL || '';
  const lines = [
    '',
    '  ┌──────────────────────────────────────────────┐',
    '  │  实践教学选题投票 · 服务已启动                │',
    '  └──────────────────────────────────────────────┘',
  ];
  if (publicUrl) lines.push(`  公网地址   : ${publicUrl}`);
  lines.push(`  本机访问   : http://127.0.0.1:${PORT}`);
  for (const ip of lanAddresses()) lines.push(`  局域网访问 : http://${ip}:${PORT}   （需同一 Wi-Fi / 局域网）`);
  lines.push(
    `  投票名额   : ${LIMIT} 人（一人一票，投满自动锁定）`,
    `  管理密码   : ${ADMIN_PASSWORD}`,
    `  存储方式   : ${storageMode === 'kv' ? '外部 Key Value（持久）' : durable ? `本地文件 ${DATA_FILE}` : '临时文件（重启会清空）'}`
  );
  if (!durable) lines.push('  提示       : 未配置 REDIS_URL，票数在实例重启后会丢失，建议按 README 配置 Key Value。');
  lines.push('', '  关闭本窗口即停止服务。', '');
  console.log(lines.join('\n'));
}

initStorage().then(() => {
  server.listen(PORT, HOST, () => {
    printBanner();
    if (!RUNNING_IN_CLOUD && ARGS.open) {
      try { openBrowser(`http://127.0.0.1:${PORT}`); } catch (_) { /* 打不开浏览器就算了 */ }
    }
  });
  // 云端实例休眠前最后一次落盘
  setInterval(() => { if (kv) syncFresh(false).catch(() => {}); }, 5000).unref();
});

function shutdown() {
  console.log('\n正在保存数据并退出…');
  writeChain.finally(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
