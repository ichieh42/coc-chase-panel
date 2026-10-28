/* 掷骰与判定：CoC 7e 百分骰、奖励/惩罚骰、成功等级、对抗检定、伤害骰 */

window.COC = window.COC || {};

COC.dice = (function () {
  'use strict';

  var LEVELS = {
    critical: { rank: 5, label: '大成功' },
    extreme: { rank: 4, label: '极难成功' },
    hard: { rank: 3, label: '困难成功' },
    regular: { rank: 2, label: '常规成功' },
    fail: { rank: 1, label: '失败' },
    fumble: { rank: 0, label: '大失败' }
  };

  function d(sides) {
    return Math.floor(Math.random() * sides) + 1;
  }

  /* 支持 "1D3-1"、"2D10"、"5D10" 等表达式 */
  function roll(expr) {
    var m = String(expr || '').trim().toUpperCase().match(/^(\d+)\s*D\s*(\d+)(?:\s*([+-])\s*(\d+))?$/);
    if (!m) return { total: 0, rolls: [], expr: expr, error: true };
    var count = parseInt(m[1], 10);
    var sides = parseInt(m[2], 10);
    var mod = m[3] ? (m[3] === '-' ? -1 : 1) * parseInt(m[4], 10) : 0;
    var rolls = [];
    for (var i = 0; i < count; i++) rolls.push(d(sides));
    var sum = rolls.reduce(function (a, b) { return a + b; }, 0);
    return { total: Math.max(0, sum + mod), rolls: rolls, expr: expr, mod: mod };
  }

  function clampValue(v) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return null;
    return Math.max(1, Math.min(100, n));
  }

  /* 返回 { value, tens, units, pick, manual, bonus, penalty } */
  function percent(opts) {
    opts = opts || {};
    if (opts.manual !== undefined && opts.manual !== null && opts.manual !== '') {
      var mv = clampValue(opts.manual);
      return {
        value: mv === null ? 1 : mv,
        tens: [], units: null, pick: null,
        manual: true, bonus: 0, penalty: 0
      };
    }
    var bonus = Math.max(0, Math.min(2, opts.bonus || 0));
    var penalty = Math.max(0, Math.min(2, opts.penalty || 0));
    var extra = Math.abs(bonus - penalty);
    var tens = [d(10) - 1];
    for (var i = 0; i < extra; i++) tens.push(d(10) - 1);
    var units = d(10) - 1;
    var pick = tens[0];
    for (var j = 1; j < tens.length; j++) {
      if (bonus > penalty) {
        if (tens[j] < pick) pick = tens[j];
      } else if (penalty > bonus) {
        if (tens[j] > pick) pick = tens[j];
      }
    }
    var value = pick * 10 + units;
    if (value === 0) value = 100;
    return {
      value: value, tens: tens, units: units, pick: pick,
      manual: false, bonus: bonus, penalty: penalty
    };
  }

  function level(value, threshold) {
    threshold = Math.max(0, threshold || 0);
    if (value === 1) return 'critical';
    var fumbleAt = threshold < 50 ? 96 : 100;
    if (value >= fumbleAt) return 'fumble';
    if (value <= Math.floor(threshold / 5)) return 'extreme';
    if (value <= Math.floor(threshold / 2)) return 'hard';
    if (value <= threshold) return 'regular';
    return 'fail';
  }

  function check(threshold, opts) {
    var r = percent(opts);
    var key = level(r.value, threshold);
    return {
      value: r.value,
      tens: r.tens,
      units: r.units,
      pick: r.pick,
      manual: r.manual,
      bonus: r.bonus,
      penalty: r.penalty,
      threshold: threshold,
      levelKey: key,
      level: LEVELS[key].label,
      rank: LEVELS[key].rank
    };
  }

  /* 对抗检定：等级高者胜；等级相同先比技能值，技能值也相同再比骰值
     （成功时骰值低者胜；双方都失败则无胜者）。返回 'a' / 'b' / 'tie' */
  function opposed(a, b) {
    var winner;
    if (a.rank !== b.rank) {
      winner = a.rank > b.rank ? 'a' : 'b';
    } else {
      var at = Number(a.threshold) || 0;
      var bt = Number(b.threshold) || 0;
      if (at !== bt) {
        winner = at > bt ? 'a' : 'b';
      } else if (a.rank < 2) {
        winner = 'tie';
      } else {
        winner = a.value < b.value ? 'a' : (a.value > b.value ? 'b' : 'tie');
      }
    }
    return { winner: winner, a: a, b: b };
  }

  return {
    LEVELS: LEVELS,
    d: d,
    roll: roll,
    percent: percent,
    level: level,
    check: check,
    opposed: opposed
  };
})();
