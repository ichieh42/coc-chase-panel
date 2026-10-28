/* 状态管理：角色卡库、追逐快照、日志、本地存储与 JSON 导入导出 */

window.COC = window.COC || {};

COC.store = (function () {
  'use strict';

  var KEY = 'coc7e-chase-console-v1';
  var SCHEMA = 3;

  var SKILLS = {
    climb: '攀爬', dodge: '闪避', swim: '游泳', jump: '跳跃', lock: '锁匠', drive: '汽车驾驶',
    pilot: '驾驶（船 / 飞行）', heavy: '重型机械', ride: '骑乘',
    stealth: '潜行', track: '追踪', spot: '侦查', navigate: '导航', fight: '格斗', shoot: '射击'
  };

  /* 载具可用的操作技能，顺序即编辑器下拉顺序 */
  var VEHICLE_SKILLS = ['drive', 'pilot', 'heavy', 'ride'];

  var KIND_LABEL = { pc: '调查员', npc: 'NPC', monster: '怪物', vehicle: '载具' };

  var DEFAULT_SKILLS = {
    climb: 40, dodge: 25, swim: 20, jump: 20, lock: 1, drive: 20,
    pilot: 1, heavy: 1, ride: 5,
    stealth: 20, track: 10, spot: 25, navigate: 10, fight: 25, shoot: 20
  };

  var state = null;
  var storageOK = true;

  function initialState() {
    return {
      schema: SCHEMA,
      chars: [],
      setup: null,
      chase: null,
      log: [],
      prefs: { diceMode: 'auto', env: 'suburb' }
    };
  }

  function uid() {
    return 'id-' + Math.random().toString(36).slice(2, 9) + '-' + Date.now().toString(36).slice(-4);
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function blankChar(kind) {
    return {
      id: uid(),
      kind: kind || 'pc',
      name: '',
      note: '',
      dex: 50,
      str: 50,
      siz: 65,
      con: 50,
      age: 0,
      build: 0,
      mov: 7,
      movOverride: null,
      luck: 50,
      hp: 11,
      hpMax: 11,
      armor: 0,
      skills: clone(DEFAULT_SKILLS),
      vehicle: { mov: 13, build: 4, armor: 1, cap: '3–4', dur: 20, durMax: 20, skill: 'drive' },
      missing: [],
      createdAt: Date.now()
    };
  }

  /* MOV 衍生：DEX / STR 与 SIZ 比较，并按年龄扣减（规则书 P122 前的 MOV 说明） */
  function movInfo(dex, str, siz, age) {
    var d = Number(dex) || 0;
    var s = Number(str) || 0;
    var z = Number(siz) || 0;
    var base, rule;
    if (d > z && s > z) {
      base = 9; rule = 'STR 与 DEX 皆大于 SIZ';
    } else if (d >= z || s >= z) {
      base = 8; rule = 'DEX 或 STR 之一等于或大于 SIZ';
    } else {
      base = 7; rule = 'DEX 与 STR 皆小于 SIZ';
    }
    var a = Number(age) || 0;
    var penalty = 0;
    if (a >= 80) penalty = 5;
    else if (a >= 70) penalty = 4;
    else if (a >= 60) penalty = 3;
    else if (a >= 50) penalty = 2;
    else if (a >= 40) penalty = 1;
    return {
      base: base,
      rule: rule,
      penalty: penalty,
      age: a,
      total: Math.max(0, base - penalty)
    };
  }

  function deriveMov(dex, str, siz, age) {
    return movInfo(dex, str, siz, age).total;
  }

  /* 生命值上限 = (SIZ + CON) / 10，向下取整 */
  function deriveHpMax(con, siz) {
    var c = Number(con) || 0;
    var z = Number(siz) || 0;
    return Math.max(1, Math.floor((z + c) / 10));
  }

  /* 体格（Build）由 STR + SIZ 查表Ⅰ得出；超过 524 后每 80 点 +1 */
  function deriveBuild(str, siz) {
    var sum = (Number(str) || 0) + (Number(siz) || 0);
    if (sum <= 64) return -2;
    if (sum <= 84) return -1;
    if (sum <= 124) return 0;
    if (sum <= 164) return 1;
    if (sum <= 204) return 2;
    if (sum <= 284) return 3;
    if (sum <= 364) return 4;
    if (sum <= 444) return 5;
    if (sum <= 524) return 6;
    return 6 + Math.floor((sum - 525) / 80) + 1;
  }

  function finalMov(c) {
    if (!c) return 0;
    if (c.kind === 'vehicle') return Number(c.vehicle && c.vehicle.mov) || 0;
    if (c.movOverride != null && c.movOverride !== '') return Number(c.movOverride) || 0;
    return deriveMov(c.dex, c.str, c.siz, c.age);
  }

  function normalizeChar(raw) {
    var c = Object.assign(blankChar(raw && raw.kind), raw || {});
    var hadHp = raw && raw.hp != null && raw.hp !== '';
    c.id = c.id || uid();
    c.kind = KIND_LABEL[c.kind] ? c.kind : 'pc';
    c.name = c.name || '未命名';
    ['dex', 'con', 'str', 'siz', 'age', 'build', 'mov', 'luck', 'hp', 'hpMax', 'armor'].forEach(function (k) {
      var n = Number(c[k]);
      c[k] = isNaN(n) ? 0 : n;
    });
    if (c.siz <= 0) c.siz = 65;
    c.movOverride = (c.movOverride === '' || c.movOverride == null || isNaN(Number(c.movOverride)))
      ? null : Number(c.movOverride);
    c.hpMax = c.kind === 'vehicle' ? 1 : deriveHpMax(c.con, c.siz);
    c.hp = hadHp ? Math.min(Math.max(0, c.hp), c.hpMax) : c.hpMax;
    c.build = c.kind === 'vehicle' ? c.build : deriveBuild(c.str, c.siz);
    c.skills = Object.assign({}, DEFAULT_SKILLS, c.skills || {});
    var v = Object.assign({}, blankChar('vehicle').vehicle, c.vehicle || {});
    ['mov', 'build', 'armor', 'dur', 'durMax'].forEach(function (k) {
      var n = Number(v[k]);
      v[k] = isNaN(n) ? 0 : n;
    });
    v.durMax = Math.max(1, v.durMax || 1);
    v.dur = Math.min(Math.max(0, v.dur || 0), v.durMax);
    c.vehicle = v;
    c.mov = finalMov(c);
    c.missing = Array.isArray(c.missing) ? c.missing : [];
    return c;
  }

  function normalizeChase(ch) {
    if (!ch || !ch.parts || !ch.locations) return null;
    ch.parts.forEach(function (p) {
      p.apBase = Math.max(0, Number(p.apBase) || 0);
      p.apUsed = Math.max(0, Number(p.apUsed) || 0);
      p.debt = Math.max(0, Number(p.debt) || 0);
      p.loc = Math.max(0, Number(p.loc) || 0);
      p.dmgPool = Math.max(0, Number(p.dmgPool) || 0);
      p.skills = Object.assign({}, DEFAULT_SKILLS, p.skills || {});
      p.statuses = p.statuses || [];
    });
    ch.hazards = ch.hazards || [];
    ch.log = ch.log || [];
    ch.pendingMove = null;
    ch.round = ch.round || 1;
    ch.turn = ch.turn || 0;
    ch.ended = !!ch.ended;
    ch.suddenNext = ch.suddenNext || 'kp';
    return ch;
  }

  function load() {
    state = initialState();
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return state;
      var data = JSON.parse(raw);
      state.schema = SCHEMA;
      state.chars = (data.chars || []).map(normalizeChar);
      state.setup = data.setup || null;
      state.chase = normalizeChase(data.chase);
      state.log = data.log || [];
      state.prefs = Object.assign(state.prefs, data.prefs || {});
    } catch (e) {
      storageOK = false;
      state = initialState();
    }
    return state;
  }

  function save() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
      storageOK = true;
    } catch (e) {
      storageOK = false;
    }
  }

  function getState() {
    if (!state) load();
    return state;
  }

  function charList() {
    return getState().chars;
  }

  function getChar(id) {
    return charList().filter(function (c) { return c.id === id; })[0] || null;
  }

  function upsert(char) {
    var list = getState().chars;
    var i = list.findIndex(function (c) { return c.id === char.id; });
    if (i >= 0) list[i] = normalizeChar(char);
    else list.push(normalizeChar(char));
    save();
  }

  function removeChar(id) {
    var s = getState();
    s.chars = s.chars.filter(function (c) { return c.id !== id; });
    if (s.setup) s.setup.entries = (s.setup.entries || []).filter(function (e) { return e.charId !== id; });
    save();
  }

  function log(text, kind) {
    var s = getState();
    var round = s.chase && !s.chase.ended ? s.chase.round : null;
    s.log.push({
      id: uid(),
      at: new Date().toISOString(),
      round: round,
      kind: kind || 'info',
      text: text
    });
    if (s.log.length > 600) s.log = s.log.slice(-600);
    save();
  }

  function clearLog() {
    getState().log = [];
    save();
  }

  function exportJSON() {
    return JSON.stringify({
      schema: SCHEMA,
      exportedAt: new Date().toISOString(),
      chars: getState().chars,
      chase: getState().chase,
      setup: getState().setup,
      log: getState().log,
      prefs: getState().prefs
    }, null, 2);
  }

  function importJSON(text) {
    var data = JSON.parse(text);
    var incoming = Array.isArray(data) ? data : (data.chars || []);
    var s = getState();
    var added = 0, updated = 0, filled = 0;
    incoming.forEach(function (raw) {
      var c = normalizeChar(raw);
      var missingFields = !raw.skills || raw.luck == null || raw.build == null || raw.vehicle == null;
      if (missingFields) filled++;
      var same = s.chars.filter(function (x) { return x.name === c.name && x.kind === c.kind; })[0];
      if (same) {
        var overwrite = window.confirm('已存在同名角色卡「' + c.name + '」。\n确定 = 覆盖原卡\n取消 = 新建一份副本');
        if (overwrite) {
          c.id = same.id;
          updated++;
        } else {
          c.id = uid();
          c.name = c.name + '（导入）';
          added++;
        }
      } else {
        c.id = uid();
        added++;
      }
      upsert(c);
    });
    if (data.chase && !s.chase) {
      s.chase = normalizeChase(data.chase);
      save();
    }
    return { added: added, updated: updated, filled: filled };
  }

  function reset() {
    state = initialState();
    try { window.localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ }
    save();
    return state;
  }

  function isStorageOK() {
    return storageOK;
  }

  return {
    KEY: KEY,
    SCHEMA: SCHEMA,
    SKILLS: SKILLS,
    VEHICLE_SKILLS: VEHICLE_SKILLS,
    KIND_LABEL: KIND_LABEL,
    DEFAULT_SKILLS: DEFAULT_SKILLS,
    load: load,
    save: save,
    getState: getState,
    charList: charList,
    getChar: getChar,
    upsert: upsert,
    removeChar: removeChar,
    uid: uid,
    blankChar: blankChar,
    normalizeChar: normalizeChar,
    movInfo: movInfo,
    deriveMov: deriveMov,
    deriveHpMax: deriveHpMax,
    deriveBuild: deriveBuild,
    finalMov: finalMov,
    log: log,
    clearLog: clearLog,
    exportJSON: exportJSON,
    importJSON: importJSON,
    reset: reset,
    isStorageOK: isStorageOK
  };
})();
