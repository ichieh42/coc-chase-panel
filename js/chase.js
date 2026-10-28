/* 追逐规则引擎：速度检定修正、行动点、放置、移动、伤害与事故 */

window.COC = window.COC || {};

COC.chase = (function () {
  'use strict';

  /* 难度 → 阈值系数与标签，单处维护，避免调用方各自判断字符串 */
  var DIFFICULTY = {
    regular: { factor: 1, label: '普通' },
    hard: { factor: 0.5, label: '困难' },
    extreme: { factor: 0.2, label: '极难' }
  };

  function difficultyInfo(difficulty) {
    return DIFFICULTY[difficulty] || DIFFICULTY.regular;
  }

  function factor(difficulty) {
    return difficultyInfo(difficulty).factor;
  }

  function difficultyLabel(difficulty) {
    return difficultyInfo(difficulty).label;
  }

  /* 速度检定结果 → MOV 修正（P112） */
  function movAdjust(base, levelKey) {
    if (levelKey === 'extreme' || levelKey === 'critical') return base + 1;
    if (levelKey === 'fail' || levelKey === 'fumble') return base - 1;
    return base;
  }

  function snapshot(char, role, movOverride) {
    var isVeh = char.kind === 'vehicle';
    var v = char.vehicle || {};
    var movBase = isVeh ? (Number(v.mov) || 0) : (Number(char.mov) || 0);
    return {
      pid: COC.store.uid(),
      charId: char.id,
      name: char.name || '未命名',
      kind: char.kind,
      role: role,
      dex: Number(char.dex) || 0,
      con: Number(char.con) || 0,
      str: Number(char.str) || 0,
      siz: isVeh ? 0 : (Number(char.siz) || 0),
      age: isVeh ? 0 : (Number(char.age) || 0),
      luck: Number(char.luck) || 50,
      build: isVeh ? (Number(v.build) || 0) : COC.store.deriveBuild(char.str, char.siz),
      movBase: movBase,
      mov: movOverride == null ? movBase : movOverride,
      hp: isVeh ? (Number(v.dur) || 0) : (Number(char.hp) || 0),
      hpMax: isVeh ? (Number(v.durMax) || 1) : (Number(char.hpMax) || 1),
      armor: isVeh ? (Number(v.armor) || 0) : (Number(char.armor) || 0),
      dmgPool: 0,
      skills: Object.assign({}, char.skills || {}),
      vehicle: isVeh ? Object.assign({}, v) : null,
      loc: 0,
      apBase: 1,
      apUsed: 0,
      debt: 0,
      statuses: [],
      passengerOf: null
    };
  }

  /* 载具的操作技能：编辑器可选，缺省为汽车驾驶 */
  function vehicleSkill(p) {
    return (p.vehicle && p.vehicle.skill) || 'drive';
  }

  /* 行动顺序：敏捷从高到低，同敏捷按姓名排，保证各入口顺序一致 */
  function sortByDex(parts) {
    return parts.slice().sort(function (a, b) {
      if (b.dex !== a.dex) return b.dex - a.dex;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
  }

  function dexTies(sorted) {
    var ties = [];
    for (var i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].dex === sorted[i + 1].dex) {
        ties.push([sorted[i].pid, sorted[i + 1].pid]);
      }
    }
    return ties;
  }

  /* 中途加入者只补充与自身同敏捷的对抗，已解决的平手不再重复 */
  function addTiesFor(chase, p) {
    var known = {};
    chase.ties = chase.ties || [];
    chase.ties.forEach(function (t) { known[t.slice().sort().join('|')] = true; });
    chase.parts.forEach(function (x) {
      if (x.pid === p.pid || x.dex !== p.dex) return;
      var key = [p.pid, x.pid].sort().join('|');
      if (known[key]) return;
      chase.ties.push([p.pid, x.pid]);
      known[key] = true;
    });
  }

  function recalcAP(parts) {
    var movers = parts.filter(function (p) { return !p.passengerOf; });
    if (!movers.length) movers = parts;
    var min = Math.min.apply(null, movers.map(function (p) { return p.mov; }));
    parts.forEach(function (p) {
      p.apBase = p.passengerOf ? 1 : 1 + Math.max(0, p.mov - min);
    });
    return min;
  }

  /* 建立追逐：返回 { chase } / { error } / { escapedOnly } */
  function build(setup) {
    var entries = (setup.entries || []).filter(function (e) {
      return e && e.charId && COC.store.getChar(e.charId);
    });
    if (!entries.length) return { error: '名单为空，请先从角色卡库添加参与者。' };

    var parts = entries.map(function (e) {
      return snapshot(COC.store.getChar(e.charId), e.role, e.mov != null ? e.mov : null);
    });

    var chasers = parts.filter(function (p) { return p.role === 'chaser'; });
    var escapees = parts.filter(function (p) { return p.role === 'escapee'; });
    if (!chasers.length) return { error: '至少需要一名追逐者。' };
    if (!escapees.length) return { error: '至少需要一名逃离者。' };

    var fastestChaser = Math.max.apply(null, chasers.map(function (p) { return p.mov; }));
    var escaped = escapees.filter(function (p) { return p.mov > fastestChaser; });
    var activeEsc = escapees.filter(function (p) { return p.mov <= fastestChaser; });
    if (!activeEsc.length) {
      return { escapedOnly: true, escaped: escaped };
    }

    var slowestEsc = Math.min.apply(null, activeEsc.map(function (p) { return p.mov; }));
    var activeChasers = chasers.filter(function (p) { return p.mov >= slowestEsc; });
    var dropped = chasers.filter(function (p) { return p.mov < slowestEsc; });

    var slowChaser = Math.min.apply(null, activeChasers.map(function (p) { return p.mov; }));
    activeChasers.forEach(function (p) { p.loc = p.mov - slowChaser; });
    activeEsc.forEach(function (p) { p.loc = (setup.gap || 2) + (p.mov - slowestEsc); });

    var active = activeChasers.concat(activeEsc);
    var minMov = recalcAP(active);

    var maxLoc = Math.max.apply(null, active.map(function (p) { return p.loc; }));
    var count = Math.max(10, maxLoc + 6);
    var locations = [];
    for (var i = 0; i < count; i++) {
      locations.push({ index: i, name: '地点 ' + (i + 1) });
    }

    var dexSorted = sortByDex(active);
    var ties = dexTies(dexSorted);

    return {
      chase: {
        id: COC.store.uid(),
        name: setup.name || '无名追逐',
        gap: setup.gap || 2,
        round: 1,
        turn: 0,
        minMov: minMov,
        parts: active,
        order: dexSorted.map(function (p) { return p.pid; }),
        ties: ties,
        locations: locations,
        hazards: [],
        suddenNext: 'kp',
        ended: false,
        startedAt: new Date().toISOString(),
        dropped: dropped.map(function (p) { return p.name; }),
        escaped: escaped.map(function (p) { return p.name; })
      }
    };
  }

  function part(chase, pid) {
    return chase.parts.filter(function (p) { return p.pid === pid; })[0] || null;
  }

  function activePart(chase) {
    if (!chase || chase.ended) return null;
    return part(chase, chase.order[chase.turn]);
  }

  function remaining(p) {
    return Math.max(0, (p.apBase || 0) - (p.apUsed || 0));
  }

  function spend(p, cost) {
    if (remaining(p) < cost) return false;
    p.apUsed += cost;
    return true;
  }

  /* 险境/战技造成的行动点损失，超出部分记为欠账，下一轮扣除 */
  function loseAP(p, n) {
    var avail = remaining(p);
    if (n <= avail) {
      p.apUsed += n;
    } else {
      p.apUsed = p.apBase;
      p.debt += (n - avail);
    }
  }

  function nextTurn(chase) {
    chase.turn += 1;
    var newRound = false;
    if (chase.turn >= chase.order.length) {
      chase.turn = 0;
      chase.round += 1;
      newRound = true;
      chase.parts.forEach(function (p) {
        p.apUsed = 0;
        if (p.debt > 0) {
          p.apUsed = Math.min(p.apBase, p.debt);
          p.debt = Math.max(0, p.debt - p.apBase);
        }
      });
    }
    return { newRound: newRound };
  }

  function shuffleOrderForTie(chase, winnerPid, loserPid) {
    var o = chase.order;
    var wi = o.indexOf(winnerPid);
    var li = o.indexOf(loserPid);
    if (wi < 0 || li < 0 || wi < li) return;
    o.splice(wi, 1);
    o.splice(li, 0, winnerPid);
  }

  function hazardsOnEdge(chase, edge) {
    return chase.hazards.filter(function (h) { return h.edge === edge; });
  }

  function applyDamage(p, amount) {
    amount = Math.max(0, Math.round(amount));
    if (p.kind === 'vehicle') {
      p.dmgPool += amount;
      var vs = vehicleState(p);
      return {
        type: 'vehicle',
        amount: amount,
        buildLoss: vs.loss,
        buildNow: vs.buildNow,
        damaged: vs.damaged,
        wrecked: vs.wrecked
      };
    }
    var before = p.hp;
    p.hp = Math.max(0, p.hp - amount);
    return { type: 'character', amount: amount, hp: p.hp, hpMax: p.hpMax, down: p.hp <= 0, before: before };
  }

  function vehicleState(p) {
    if (p.kind !== 'vehicle') return null;
    var loss = Math.floor(p.dmgPool / 10);
    var buildNow = Math.max(0, Math.round((p.build - loss) * 10) / 10);
    return {
      buildNow: buildNow,
      damaged: buildNow * 2 < p.build,
      wrecked: buildNow <= 0,
      loss: loss
    };
  }

  function skillValue(p, key) {
    if (key === 'str') return p.str;
    if (key === 'dex') return p.dex;
    if (key === 'con') return p.con;
    return p.skills[key] || 0;
  }

  function vehicleAttackDice(p) {
    var n = Math.max(1, Math.round(p.build || 1));
    return n + 'D10';
  }

  function addLocation(chase, name) {
    var idx = chase.locations.length;
    chase.locations.push({ index: idx, name: name || ('地点 ' + (idx + 1)) });
    return idx;
  }

  return {
    factor: factor,
    difficultyLabel: difficultyLabel,
    movAdjust: movAdjust,
    snapshot: snapshot,
    vehicleSkill: vehicleSkill,
    sortByDex: sortByDex,
    addTiesFor: addTiesFor,
    recalcAP: recalcAP,
    build: build,
    part: part,
    activePart: activePart,
    remaining: remaining,
    spend: spend,
    loseAP: loseAP,
    nextTurn: nextTurn,
    shuffleOrderForTie: shuffleOrderForTie,
    hazardsOnEdge: hazardsOnEdge,
    applyDamage: applyDamage,
    vehicleState: vehicleState,
    skillValue: skillValue,
    vehicleAttackDice: vehicleAttackDice,
    addLocation: addLocation
  };
})();
