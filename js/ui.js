/* 界面与交互：角色卡库、建立追逐、地点轨、险境/障碍、冲突、速查与日志 */

(function () {
  'use strict';

  var modalRoot, toastEl, toastTimer;
  var closeHooks = [];
  var ui = { tab: 'library', toolsOpen: false };
  var refsQuery = '';

  function st() { return COC.store.getState(); }
  function prefs() { return st().prefs; }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function timeText(iso) {
    var d = new Date(iso);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function toast(msg, tone) {
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (tone === 'bad' ? ' bad' : '');
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }
  function save() { COC.store.save(); }
  function log(text) { COC.store.log(text); }

  /* ---------------- 模态框 ---------------- */

  /* 标题与副标题一律当纯文本处理，避免角色名等用户输入注入 HTML */
  function openModal(opts) {
    modalRoot.innerHTML =
      '<div class="modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
        '<div class="modal-head">' +
          '<div><h3>' + esc(opts.title || '') + '</h3>' +
          (opts.sub ? '<div class="sub">' + esc(opts.sub) + '</div>' : '') + '</div>' +
          '<button class="btn tiny ghost" data-close>关闭</button>' +
        '</div>' +
        '<div class="modal-body">' + (opts.body || '') + '</div>' +
        (opts.foot ? '<div class="modal-foot">' + opts.foot + '</div>' : '') +
      '</div>';
    modalRoot.hidden = false;
  }

  function closeModal() {
    closeHooks = [];
    modalRoot.hidden = true;
    modalRoot.innerHTML = '';
  }

  /* 用户主动关闭弹窗时触发（用于中断的移动等清理） */
  function userCloseModal() {
    var hooks = closeHooks;
    closeHooks = [];
    hooks.forEach(function (fn) { fn(); });
    closeModal();
  }

  function registerCloseHook(fn) {
    closeHooks.push(fn);
  }

  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  /* 读取数字字段；留空或非法时返回默认值，并记录到 missing */
  function readNum(id, fallback, missing, label) {
    var el = document.getElementById(id);
    if (!el) return fallback;
    var raw = String(el.value).trim();
    var n = raw === '' ? NaN : parseFloat(raw);
    if (isNaN(n)) {
      if (missing && label && missing.indexOf(label) < 0) missing.push(label);
      return fallback;
    }
    return n;
  }

  /* 通用检定输入区 */
  function rollFields(prefix, threshold, bonus, penalty) {
    var manual = prefs().diceMode === 'manual';
    return '<div class="form-grid">' +
      '<label class="field"><span>阈值 / 技能值</span><input id="' + prefix + 'Thr" type="number" min="0" max="200" value="' + threshold + '"></label>' +
      '<label class="field"><span>奖励骰（最多 2）</span><input id="' + prefix + 'Bonus" type="number" min="0" max="2" value="' + (bonus || 0) + '"></label>' +
      '<label class="field"><span>惩罚骰（最多 2）</span><input id="' + prefix + 'Penalty" type="number" min="0" max="2" value="' + (penalty || 0) + '"></label>' +
      (manual ? '<label class="field"><span>手动录入骰值（1–100）</span><input id="' + prefix + 'Manual" type="number" min="1" max="100" value="50"></label>' : '') +
    '</div>';
  }

  function readManual(prefix) {
    var el = document.getElementById(prefix + 'Manual');
    if (!el) return undefined;
    var n = parseInt(el.value, 10);
    return isNaN(n) ? undefined : n;
  }

  function readRoll(prefix) {
    var thr = parseInt(val(prefix + 'Thr'), 10);
    if (isNaN(thr) || thr < 0) thr = 0;
    var bonus = Math.max(0, Math.min(2, parseInt(val(prefix + 'Bonus'), 10) || 0));
    var penalty = Math.max(0, Math.min(2, parseInt(val(prefix + 'Penalty'), 10) || 0));
    var manual = readManual(prefix);
    return COC.dice.check(thr, { bonus: bonus, penalty: penalty, manual: manual });
  }

  function checkHTML(r, label) {
    var detail = r.manual
      ? '手动录入'
      : '十位 ' + r.tens.join(' / ') + ' · 个位 ' + r.units;
    return '<div class="check-result">' +
      '<div class="check-line"><span class="val">' + r.value + '</span>' +
      '<span class="badge ' + r.levelKey + '">' + r.level + '</span>' +
      '<span class="note">' + (label ? esc(label) + ' · ' : '') + '阈值 ' + r.threshold + '%</span></div>' +
      '<div class="dice-detail">' + detail +
      ((r.bonus || r.penalty) ? ' · 奖励 ' + r.bonus + ' / 惩罚 ' + r.penalty : '') +
      '</div></div>';
  }

  function diceNote(r) {
    return r.rolls ? (r.rolls.join(' + ') + (r.mod ? (r.mod > 0 ? ' + ' + r.mod : ' ' + r.mod) : '') + ' = ' + r.total) : String(r.total);
  }

  /* ---------------- 顶层交互 ---------------- */

  function bindTop() {
    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchTab(btn.dataset.view);
      });
    });

    var mode = document.getElementById('diceMode');
    mode.addEventListener('change', function () {
      prefs().diceMode = mode.value;
      save();
      toast(mode.value === 'manual' ? '已切换为手动录入骰值' : '已切换为自动掷骰');
    });

    document.getElementById('btnExport').addEventListener('click', exportFile);
    document.getElementById('btnImport').addEventListener('click', function () {
      document.getElementById('fileImport').click();
    });
    document.getElementById('fileImport').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var res = COC.store.importJSON(String(reader.result));
          syncPrefs();
          renderAll();
          toast('导入完成：新增 ' + res.added + '，覆盖 ' + res.updated + (res.filled ? '，补全 ' + res.filled + ' 份缺省字段' : ''));
        } catch (err) {
          toast('导入失败：' + err.message, 'bad');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    document.getElementById('btnReset').addEventListener('click', function () {
      if (!window.confirm('将清空本地保存的角色卡、追逐与日志，且不可撤销。确认继续？')) return;
      COC.store.reset();
      syncPrefs();
      renderAll();
      toast('本地数据已清空');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modalRoot.hidden) userCloseModal();
    });
  }

  function exportFile() {
    var data = COC.store.exportJSON();
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = new Date();
    a.href = url;
    a.download = 'coc7e-chase-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('已导出 JSON');
  }

  function syncPrefs() {
    var mode = document.getElementById('diceMode');
    if (mode) mode.value = prefs().diceMode || 'auto';
  }

  function switchTab(view) {
    if (['library', 'chase', 'refs', 'log'].indexOf(view) < 0) view = 'library';
    ui.tab = view;
    document.querySelectorAll('.tab').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.view === view);
    });
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('is-active'); });
    var target = document.getElementById('view-' + view);
    if (target) target.classList.add('is-active');
    renderView(view);
  }

  /* 只重建当前页签，避免隐藏页签的输入与滚动位置被清空 */
  function renderView(view) {
    if (view === 'chase') renderChase();
    else if (view === 'refs') renderRefs();
    else if (view === 'log') renderLog();
    else renderLibrary();
  }

  function renderAll() {
    syncPrefs();
    renderView(ui.tab);
  }

  /* ---------------- 角色卡库 ---------------- */

  function renderLibrary() {
    var view = document.getElementById('view-library');
    var chars = st().chars;
    var cards = chars.map(charCardHTML).join('');
    view.innerHTML =
      '<div class="view-head">' +
        '<div><h2>角色卡库</h2><p>录入调查员、NPC、怪物与载具。追逐开始时使用快照，之后的伤害与行动点不会改动原卡。</p></div>' +
        '<div class="view-actions">' +
          '<button class="btn primary" data-act="new-char">新建角色</button>' +
          '<button class="btn" data-act="new-vehicle">新建载具</button>' +
        '</div>' +
      '</div>' +
      (chars.length
        ? '<div class="grid">' + cards + '</div>'
        : '<div class="empty">还没有角色卡。点击「新建角色」开始，或从 JSON 导入已有数据。</div>');
  }

  function charCardHTML(c) {
    var isVeh = c.kind === 'vehicle';
    var v = c.vehicle || {};
    var stats = isVeh
      ? [['MOV', v.mov], ['体格', v.build], ['护甲', v.armor], ['耐久', v.dur + '/' + v.durMax]]
      : [['DEX', c.dex], ['STR', c.str], ['SIZ', c.siz], ['CON', c.con], ['MOV', c.mov]];
    var hpNow = isVeh ? v.dur : c.hp;
    var hpMax = isVeh ? v.durMax : c.hpMax;
    var pct = Math.max(0, Math.min(100, Math.round((hpNow / Math.max(1, hpMax)) * 100)));
    var keySkills = ['climb', 'dodge', 'drive'].map(function (k) {
      return '<span class="chip">' + COC.store.SKILLS[k] + ' ' + (c.skills[k] || 0) + '%</span>';
    }).join('');
    var missingTip = (c.missing || []).join('、');
    var movNote = '';
    if (!isVeh) {
      var info = COC.store.movInfo(c.dex, c.str, c.siz, c.age);
      var movText = c.movOverride != null
        ? 'MOV ' + c.mov + '（覆盖 · 衍生 ' + info.total + '）'
        : 'MOV = ' + info.base + (info.penalty ? ' − ' + info.penalty + '（年龄 ' + c.age + '）' : '');
      movNote = '<span class="chip">HP ' + hpNow + '/' + hpMax + '</span>' +
        '<span class="chip">' + movText + '</span>' +
        '<span class="chip">体格 ' + COC.store.deriveBuild(c.str, c.siz) + '</span>';
    }

    return '<div class="char-card' + (isVeh ? ' is-vehicle' : '') + '">' +
      '<div class="char-title"><div><h3>' + esc(c.name || '未命名') + '</h3>' +
        '<div class="kind">' + COC.store.KIND_LABEL[c.kind] + (c.note ? ' · ' + esc(c.note) : '') + '</div></div>' +
        '<span class="badge' + (isVeh ? ' vehicle' : '') + '">' + (isVeh ? '载具' : '角色') + '</span>' +
      '</div>' +
      '<div class="stat-row">' + stats.map(function (s) {
        return '<span class="stat">' + s[0] + ' <b>' + s[1] + '</b></span>';
      }).join('') + '</div>' +
      '<div class="hpbar' + (isVeh ? ' veh' : '') + '"><i style="width:' + pct + '%"></i></div>' +
      (isVeh ? '' : '<div class="chips">' + movNote + '</div>') +
      (isVeh ? '' : '<div class="chips">' + keySkills + '</div>') +
      (missingTip ? '<p class="hint warn">数据不完整：' + esc(missingTip) + ' 按默认值</p>' : '') +
      '<div class="card-actions">' +
        '<button class="btn tiny" data-act="edit-char" data-id="' + c.id + '">编辑</button>' +
        '<button class="btn tiny ghost" data-act="dup-char" data-id="' + c.id + '">复制</button>' +
        '<button class="btn tiny ghost" data-act="del-char" data-id="' + c.id + '">删除</button>' +
        '<button class="btn tiny primary" data-act="to-chase" data-id="' + c.id + '">加入追逐</button>' +
      '</div></div>';
  }

  function openEditor(raw, kind) {
    var c = raw ? JSON.parse(JSON.stringify(raw)) : COC.store.blankChar(kind || 'pc');
    var isNew = !raw;
    var D = COC.store.DEFAULT_SKILLS;

    /* 技能仅在展开后填写，留空即采用基础值 */
    var skillInputs = Object.keys(COC.store.SKILLS).map(function (k) {
      var filled = raw && raw.skills && raw.skills[k] != null;
      return '<label class="field"><span>' + COC.store.SKILLS[k] +
        ' <span class="muted">基础 ' + (D[k] || 0) + '</span></span>' +
        '<input type="number" min="0" max="200" data-skill="' + k + '" placeholder="' + (D[k] || 0) + '"' +
        (filled ? ' value="' + c.skills[k] + '"' : '') + '></label>';
    }).join('');

    var vehicleOptions = COC.tables.vehicleCategories.map(function (cat) {
      return '<optgroup label="' + cat.name + '">' + cat.items.map(function (item) {
        return '<option value="' + esc(item.name) + '">' + esc(item.name) + ' · MOV ' + item.mov + ' / 体格 ' + item.build + '</option>';
      }).join('') + '</optgroup>';
    }).join('');

    function num(id, label, current, opts) {
      opts = opts || {};
      var def = opts.ph != null ? opts.ph : current;
      return '<label class="field"><span>' + label + '</span>' +
        '<input id="' + id + '" type="number" min="' + (opts.min != null ? opts.min : 0) +
        '" max="' + (opts.max != null ? opts.max : 200) + '"' +
        (opts.step ? ' step="' + opts.step + '"' : '') +
        ' placeholder="' + def + '" value="' + (isNew ? '' : current) + '"></label>';
    }

    var body =
      '<div class="form-grid">' +
        '<label class="field"><span>名称 <b class="req">必填</b></span><input id="edName" type="text" value="' + esc(isNew ? '' : c.name) + '" placeholder="如：哈维·沃尔特斯"></label>' +
        '<label class="field"><span>类型</span><select id="edKind">' +
          ['pc', 'npc', 'monster', 'vehicle'].map(function (k) {
            return '<option value="' + k + '"' + (c.kind === k ? ' selected' : '') + '>' + COC.store.KIND_LABEL[k] + '</option>';
          }).join('') + '</select></label>' +
        '<label class="field wide"><span>备注（可选）</span><input id="edNote" type="text" value="' + esc(isNew ? '' : c.note) + '" placeholder="如：记者、农庄看守"></label>' +
      '</div>' +

      /* ---- 角色：追逐必需 ---- */
      '<div class="panel" id="edCharCore">' +
        '<div class="panel-head"><h3>追逐必需</h3><span class="sub">P112–113 · 留空按默认值处理</span></div>' +
        '<div class="form-grid">' +
          num('edDex', '敏捷 DEX · 行动顺序、MOV', c.dex, { ph: 50 }) +
          num('edStr', '力量 STR · MOV', c.str, { ph: 50 }) +
          num('edSiz', '体型 SIZ · MOV 基准', c.siz, { ph: 65 }) +
          num('edCon', '体质 CON · 步行速度检定', c.con, { ph: 50 }) +
          num('edAge', '年龄（岁，可选）', c.age || '', { max: 120, ph: '例：42' }) +
          '<label class="field"><span>MOV（自动衍生）</span>' +
            '<div class="derived" id="edMovOut">7</div>' +
          '</label>' +
        '</div>' +
        '<p class="hint" id="edMovRule">由 DEX / STR 与 SIZ 比较得出，并按年龄扣减：40–49 −1、50–59 −2、60–69 −3、70–79 −4、80 以上 −5。</p>' +
      '</div>' +

      /* ---- 载具：追逐必需 ---- */
      '<div class="panel" id="edVehCore">' +
        '<div class="panel-head"><h3>载具必需</h3><span class="sub">表Ⅴ（P122）· 留空按默认值处理</span></div>' +
        '<label class="field"><span>从表Ⅴ套用预设（可选）</span><select id="edVehPreset"><option value="">— 不套用 —</option>' + vehicleOptions + '</select></label>' +
        '<div class="form-grid">' +
          num('edVehDex', '驾驶员敏捷 DEX · 行动顺序', c.dex, { ph: 50 }) +
          num('edVehMov', '载具 MOV · 以表Ⅴ为准', c.vehicle.mov, { max: 40, ph: 14 }) +
          num('edVehBuild', '体格 · 撞击与战技', c.vehicle.build, { max: 80, step: 0.5, ph: 5 }) +
          num('edVehDur', '耐久 · 承受的伤害', c.vehicle.dur, { max: 400, ph: 25 }) +
        '</div>' +
        '<p class="hint">载具 MOV 直接取自表Ⅴ，不由角色属性衍生；速度检定使用下方选定的载具操作技能。</p>' +
      '</div>' +

      /* ---- 可选：更多角色属性 ---- */
      '<div class="more-head" id="edMoreHead">' +
        '<button class="btn tiny ghost" id="edMoreToggle">▸ 更多属性（可选）</button>' +
        '<span class="muted">幸运、体格、HP、护甲、MOV 覆盖</span>' +
      '</div>' +
      '<div id="edMoreBox" hidden>' +
        '<div class="form-grid">' +
          num('edLuck', '幸运 Luck', c.luck || 50, { max: 99, ph: 50 }) +
          '<label class="field"><span>体格 Build（自动衍生）</span>' +
            '<div class="derived" id="edBuildOut">' + c.build + '</div>' +
          '</label>' +
          num('edHp', '当前生命值 HP（留空为满值）', c.hp, { ph: c.hpMax }) +
          '<label class="field"><span>生命值上限（自动衍生）</span>' +
            '<div class="derived" id="edHpOut">' + c.hpMax + '</div>' +
          '</label>' +
          num('edArmor', '护甲', c.armor, { max: 30, ph: 0 }) +
          num('edMovOverride', 'MOV 覆盖（怪物等特殊移动）', c.movOverride == null ? '' : c.movOverride, { max: 40, ph: '留空则自动衍生' }) +
        '</div>' +
        '<p class="hint">体格 = 表Ⅰ（STR + SIZ），用于战技与载具撞击；生命值上限 =（SIZ + CON）÷ 10 向下取整；MOV 覆盖用于怪物、游泳 / 飞行等特殊移动方式。</p>' +
      '</div>' +

      /* ---- 可选：载具其余数据 ---- */
      '<div class="more-head" id="edVehMoreHead">' +
        '<button class="btn tiny ghost" id="edVehMoreToggle">▸ 载具其余数据（可选）</button>' +
        '<span class="muted">乘客护甲、乘客数、耐久上限、操作技能</span>' +
      '</div>' +
      '<div id="edVehMoreBox" hidden>' +
        '<div class="form-grid">' +
          num('edVehArmor', '乘客护甲', c.vehicle.armor, { max: 80, ph: 0 }) +
          '<label class="field"><span>乘客数</span><input id="edVehCap" type="text" placeholder="4" value="' + esc(isNew ? '' : (c.vehicle.cap || '')) + '"></label>' +
          num('edVehDurMax', '耐久上限', c.vehicle.durMax, { min: 1, max: 400, ph: 25 }) +
          '<label class="field"><span>操作技能</span><select id="edVehSkill">' +
            COC.store.VEHICLE_SKILLS.map(function (k) {
              return '<option value="' + k + '"' + (c.vehicle.skill === k ? ' selected' : '') + '>' + COC.store.SKILLS[k] + '</option>';
            }).join('') +
          '</select></label>' +
        '</div>' +
      '</div>' +

      /* ---- 可选：技能 ---- */
      '<div class="more-head">' +
        '<button class="btn tiny ghost" id="edSkillToggle">▸ 技能（可选）</button>' +
        '<span class="muted">用于险境、障碍与冲突检定；留空即采用基础值</span>' +
      '</div>' +
      '<div id="edSkillBox" hidden><div class="form-grid">' + skillInputs + '</div></div>';

    openModal({
      title: isNew ? '新建角色卡' : '编辑角色卡',
      sub: '只有名称必填；追逐必需项留空会按默认值处理，之后可随时编辑',
      wide: true,
      body: body,
      foot: '<button class="btn" data-close>取消</button><button class="btn primary" id="edSave">保存</button>'
    });

    /* 载具模式隐藏角色属性面板；切换时把 DEX 带过去，避免重复填写 */
    function syncKind() {
      var isVeh = val('edKind') === 'vehicle';
      var charDex = document.getElementById('edDex');
      var vehDex = document.getElementById('edVehDex');
      if (isVeh && charDex && vehDex && vehDex.value === '') vehDex.value = charDex.value;
      if (!isVeh && charDex && vehDex && charDex.value === '') charDex.value = vehDex.value;
      document.getElementById('edCharCore').style.display = isVeh ? 'none' : '';
      document.getElementById('edVehCore').style.display = isVeh ? '' : 'none';
      document.getElementById('edMoreHead').style.display = isVeh ? 'none' : '';
      document.getElementById('edVehMoreHead').style.display = isVeh ? '' : 'none';
      if (isVeh) {
        document.getElementById('edMoreBox').hidden = true;
        document.getElementById('edMoreToggle').textContent = '▸ 更多属性（可选）';
      } else {
        document.getElementById('edVehMoreBox').hidden = true;
        document.getElementById('edVehMoreToggle').textContent = '▸ 载具其余数据（可选）';
      }
    }
    document.getElementById('edKind').addEventListener('change', syncKind);
    syncKind();

    /* MOV 为衍生值：DEX / STR 与 SIZ 比较，再按年龄扣减 */
    function numOr(id, fallback) {
      var el = document.getElementById(id);
      if (!el) return fallback;
      var raw = String(el.value).trim();
      var n = raw === '' ? NaN : parseFloat(raw);
      return isNaN(n) ? fallback : n;
    }
    function updateMovPreview() {
      var out = document.getElementById('edMovOut');
      var hpOut = document.getElementById('edHpOut');
      var buildOut = document.getElementById('edBuildOut');
      var conVal = numOr('edCon', 50);
      var sizVal = numOr('edSiz', 65);
      var strVal = numOr('edStr', 50);
      var hpMax = COC.store.deriveHpMax(conVal, sizVal);
      if (hpOut) {
        hpOut.textContent = hpMax;
        var hpEl = document.getElementById('edHp');
        if (hpEl) hpEl.placeholder = hpMax;
      }
      if (buildOut) buildOut.textContent = COC.store.deriveBuild(strVal, sizVal);
      if (!out) return;
      var info = COC.store.movInfo(numOr('edDex', 50), strVal, sizVal, numOr('edAge', 0));
      var overrideEl = document.getElementById('edMovOverride');
      var override = overrideEl ? String(overrideEl.value).trim() : '';
      var ageText = info.penalty ? '；年龄 ' + (info.age || 0) + ' → −' + info.penalty : '';
      if (override !== '') {
        out.textContent = override;
        out.classList.add('is-override');
        document.getElementById('edMovRule').textContent =
          '已手动覆盖为 ' + override + '（衍生值 ' + info.total + '：' + info.rule + ageText + '）。';
      } else {
        out.textContent = info.total;
        out.classList.remove('is-override');
        document.getElementById('edMovRule').textContent =
          info.rule + ' → ' + info.base + ageText + '。年龄扣减：40–49 −1、50–59 −2、60–69 −3、70–79 −4、80 以上 −5。';
      }
    }
    ['edDex', 'edStr', 'edSiz', 'edCon', 'edAge', 'edMovOverride'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', updateMovPreview);
    });
    updateMovPreview();

    function wireToggle(btnId, boxId, label) {
      document.getElementById(btnId).addEventListener('click', function () {
        var box = document.getElementById(boxId);
        box.hidden = !box.hidden;
        this.textContent = (box.hidden ? '▸ ' : '▾ ') + label;
      });
    }
    wireToggle('edMoreToggle', 'edMoreBox', '更多属性（可选）');
    wireToggle('edVehMoreToggle', 'edVehMoreBox', '载具其余数据（可选）');
    wireToggle('edSkillToggle', 'edSkillBox', '技能（可选）');

    document.getElementById('edVehPreset').addEventListener('change', function () {
      var name = this.value;
      if (!name) return;
      var found = null;
      COC.tables.vehicleCategories.forEach(function (cat) {
        cat.items.forEach(function (item) { if (item.name === name) { found = item; found.skill = cat.skill; } });
      });
      if (!found) return;
      var dur = Math.max(10, Math.round(found.build * 5));
      document.getElementById('edVehMov').value = found.mov;
      document.getElementById('edVehBuild').value = found.build;
      document.getElementById('edVehDur').value = dur;
      document.getElementById('edVehDurMax').value = dur;
      document.getElementById('edVehArmor').value = found.armor;
      document.getElementById('edVehCap').value = found.cap;
      document.getElementById('edVehSkill').value = found.skill;
      if (!val('edName')) document.getElementById('edName').value = found.name;
    });

    document.getElementById('edSave').addEventListener('click', function () {
      var name = val('edName').trim();
      if (!name) { toast('请填写名称', 'bad'); return; }
      var kindNow = val('edKind');
      var isVeh = kindNow === 'vehicle';
      var missing = [];

      var skills = {};
      document.querySelectorAll('[data-skill]').forEach(function (input) {
        var key = input.dataset.skill;
        var raw = String(input.value).trim();
        skills[key] = raw === '' ? (D[key] || 0) : (parseFloat(raw) || 0);
      });

      var missChar = isVeh ? null : missing;
      var missVeh = isVeh ? missing : null;
      var dex = isVeh ? readNum('edVehDex', 50, missVeh, '驾驶员敏捷') : readNum('edDex', 50, missChar, '敏捷');
      var str = isVeh ? 50 : readNum('edStr', 50, missChar, '力量');
      var siz = isVeh ? 65 : readNum('edSiz', 65, missChar, '体型');
      var con = isVeh ? c.con : readNum('edCon', 50, missChar, '体质');
      var age = isVeh ? 0 : Math.max(0, readNum('edAge', 0, null, null));
      var hpMax = isVeh ? 1 : COC.store.deriveHpMax(con, siz);
      var movOverride = isVeh ? null : (function () {
        var raw = String(val('edMovOverride')).trim();
        if (raw === '') return null;
        var n = parseFloat(raw);
        return isNaN(n) ? null : Math.max(0, n);
      })();
      var out = {
        id: c.id,
        kind: kindNow,
        name: name,
        note: val('edNote').trim(),
        dex: dex,
        str: str,
        siz: siz,
        age: age,
        con: con,
        build: isVeh ? 0 : COC.store.deriveBuild(str, siz),
        mov: isVeh ? 0 : (movOverride != null ? movOverride : COC.store.deriveMov(dex, str, siz, age)),
        movOverride: movOverride,
        luck: isVeh ? (c.luck || 50) : readNum('edLuck', 50, null, null),
        hp: isVeh ? 0 : Math.min(hpMax, readNum('edHp', hpMax, null, null)),
        hpMax: hpMax,
        armor: isVeh ? 0 : readNum('edArmor', 0, null, null),
        skills: skills,
        vehicle: {
          mov: readNum('edVehMov', 14, missVeh, '载具 MOV'),
          build: readNum('edVehBuild', 5, missVeh, '载具体格'),
          armor: readNum('edVehArmor', 0, null, null),
          cap: val('edVehCap'),
          dur: readNum('edVehDur', 25, missVeh, '载具耐久'),
          durMax: Math.max(1, readNum('edVehDurMax', 25, null, null)),
          skill: val('edVehSkill')
        },
        missing: missing,
        createdAt: c.createdAt || Date.now()
      };
      if (!isVeh) out.vehicle = Object.assign({}, c.vehicle);

      COC.store.upsert(out);
      closeModal();
      renderAll();
      toast((isNew ? '已新建角色卡：' : '已保存：') + name +
        (isVeh ? '' : '｜MOV ' + COC.store.finalMov(out)) +
        (missing.length ? '｜' + missing.join('、') + ' 使用默认值' : ''));
    });
  }

  /* ---------------- 追逐：建立 ---------------- */

  function ensureSetup() {
    var s = st();
    if (!s.setup) s.setup = { name: '无名追逐', gap: 2, entries: [] };
    if (!s.setup.entries) s.setup.entries = [];
    return s.setup;
  }

  function baseMov(c) {
    return c.kind === 'vehicle' ? (c.vehicle.mov || 0) : (c.mov || 0);
  }

  function renderChase() {
    var view = document.getElementById('view-chase');
    var chase = st().chase;
    if (chase) renderPanel(view, chase);
    else renderSetup(view);
  }

  function renderSetup(view) {
    var setup = ensureSetup();
    var rows = setup.entries.length ? setup.entries.map(function (e, i) {
      var c = COC.store.getChar(e.charId);
      if (!c) return '';
      var base = baseMov(c);
      var mov = e.mov == null ? base : e.mov;
      var stateText = e.checked
        ? (e.levelLabel + ' → MOV ' + mov)
        : ('未检定 · 基础 MOV ' + base);
      return setupRowHTML(c.name, COC.store.KIND_LABEL[c.kind] + ' · ' + stateText,
        '<div class="seg">' +
          '<button data-act="role" data-role="chaser" data-i="' + i + '" class="' + (e.role !== 'escapee' ? 'on' : '') + '">追逐者</button>' +
          '<button data-act="role" data-role="escapee" data-i="' + i + '" class="' + (e.role === 'escapee' ? 'on' : '') + '">逃离者</button>' +
        '</div>' +
        '<button class="btn tiny" data-act="part-speed" data-i="' + i + '">' + (e.checked ? '重投' : '速度检定') + '</button>' +
        '<button class="btn tiny ghost" data-act="part-remove" data-i="' + i + '">×</button>');
    }).join('') : '<p class="hint">从角色卡库添加参与者，并为每人指定追逐者 / 逃离者。</p>';

    var chaserCount = 0, escCount = 0, movs = [], unchecked = 0;
    setup.entries.forEach(function (e) {
      var c = COC.store.getChar(e.charId);
      if (!c) return;
      if (e.role === 'escapee') escCount++; else chaserCount++;
      var mov = e.mov == null ? baseMov(c) : e.mov;
      movs.push(mov);
      if (!e.checked) unchecked++;
    });
    var minMov = movs.length ? Math.min.apply(null, movs) : 0;
    var summary =
      kvRow('追逐者', chaserCount) + kvRow('逃离者', escCount) +
      kvRow('全场最低 MOV', movs.length ? minMov : '—') +
      kvRow('起始间距', setup.gap + ' 个地点') +
      (unchecked ? '<span class="hint warn">' + unchecked + ' 名参与者尚未进行速度检定，将按基础 MOV 处理。</span>' : '');

    view.innerHTML =
      '<div class="view-head"><div><h2>建立追逐</h2>' +
        '<p>速度检定 → 比较 MOV → 放置参与者 → 计算行动点。规则见 P112–113 与 P124–125。</p></div>' +
        '<div class="view-actions"><button class="btn ghost" data-act="reset-setup">重置名单</button></div>' +
      '</div>' +
      '<div class="setup-grid">' +
        '<div class="panel"><div class="panel-head"><h3>参战名单</h3>' +
          '<button class="btn small" data-act="add-part">从卡库添加</button></div>' +
          '<div class="setup-list">' + rows + '</div>' +
        '</div>' +
        '<div class="panel"><div class="panel-head"><h3>追逐配置</h3></div>' +
          '<div class="form-grid one">' +
            '<label class="field"><span>场景名称</span><input id="setupName" type="text" data-setup="name" value="' + esc(setup.name) + '"></label>' +
            '<label class="field"><span>起始间距（地点）</span><input id="setupGap" type="number" min="1" max="5" data-setup="gap" value="' + setup.gap + '"></label>' +
          '</div>' +
          '<p class="hint">规则建议追逐者位于逃离者后方 2 个地点；紧张场景可用 1 个，不建议大于 2（P112）。</p>' +
          '<div class="summary">' + summary + '</div>' +
          '<button class="btn primary wide" data-act="start-chase">建立追逐</button>' +
        '</div>' +
      '</div>';
  }

  /* 摘要行：键当纯文本，值允许带标记（例如动态更新的 <span>） */
  function kvRow(k, v) {
    return '<div class="row"><span>' + esc(k) + '</span><b>' + v + '</b></div>';
  }

  /* 名单行：标题 + 说明 + 右侧操作区 */
  function setupRowHTML(title, meta, actions) {
    return '<div class="setup-row"><div class="who"><strong>' + esc(title) + '</strong>' +
      '<span class="muted">' + meta + '</span></div>' + actions + '</div>';
  }

  /* ---------------- 追逐：面板 ---------------- */

  function renderPanel(view, chase) {
    var active = COC.chase.activePart(chase);
    var minMov = chase.minMov != null ? chase.minMov : Math.min.apply(null, chase.parts.map(function (p) { return p.mov; }));
    var order = chase.order.map(function (pid) { return COC.chase.part(chase, pid); }).filter(Boolean);
    var ended = chase.ended;

    view.innerHTML =
      '<div class="chase-head">' +
        '<div><h2>' + esc(chase.name) + '</h2><p>' +
          (ended ? '追逐已结束 · ' : '第 ' + chase.round + ' 轮 · 当前行动：' + (active ? esc(active.name) : '—') + ' · ') +
          '最慢 MOV ' + minMov + ' · 起始间距 ' + chase.gap + ' 个地点</p></div>' +
        '<div class="view-actions">' +
          (ended
            ? '<button class="btn primary" data-act="archive-chase">新建追逐</button>'
            : '<button class="btn primary" data-act="next-turn">结束当前回合</button>') +
          '<button class="btn ghost" data-act="add-loc">添加地点</button>' +
          '<button class="btn ghost" data-act="add-hazard">放置险境 / 障碍</button>' +
          (ended ? '' : '<button class="btn ghost danger" data-act="end-chase">结束追逐</button>') +
        '</div>' +
      '</div>' +
      '<div class="panel">' +
        '<div class="panel-head"><h3>地点轨</h3><span class="sub">点击棋子选择角色 · 点击险境结算 · 点击地点名重命名</span></div>' +
        '<div class="track-wrap"><div class="track">' + trackHTML(chase) + '</div></div>' +
        '<div class="track-legend">' +
          '<span class="badge escapee">逃离者</span><span class="badge chaser">追逐者</span>' +
          '<span class="badge">地点</span><span class="badge vehicle">载具</span>' +
          '<span class="muted">棋子上的数字为剩余行动点</span>' +
        '</div>' +
      '</div>' +
      '<div class="chase-grid">' +
        '<div class="panel">' +
          '<div class="panel-head"><h3>参与者</h3><span class="sub">按敏捷从高到低行动</span></div>' +
          '<div class="actor-list">' + order.map(function (p, idx) { return actorRowHTML(p, chase, active, idx); }).join('') + '</div>' +
          tieHTML(chase) +
        '</div>' +
        (ended ? endPanelHTML(chase) : actionPanelHTML(chase, active)) +
      '</div>' +
      (ended ? '' : toolsPanelHTML(chase));
  }

  function trackHTML(chase) {
    var active = COC.chase.activePart(chase);
    var activePid = active ? active.pid : null;
    return chase.locations.map(function (loc, i) {
      var hs = COC.chase.hazardsOnEdge(chase, i);
      var tokens = chase.parts.filter(function (p) { return p.loc === i; });
      return '<div class="node">' +
        (hs.length ? '<div class="tokens">' + hs.map(hazardChipHTML).join('') + '</div>' : '<div class="tokens"></div>') +
        '<div class="loc-index">' + pad2(i) + '</div>' +
        '<div class="dot"></div>' +
        '<div class="loc-name" data-act="rename-loc" data-i="' + i + '">' + esc(loc.name) + '</div>' +
        '<div class="tokens">' + tokens.map(function (p) {
          return '<span class="token ' + p.role + (p.pid === activePid ? ' is-active' : '') + '" data-act="select-actor" data-pid="' + p.pid + '" title="' + esc(p.name) + '">' +
            esc(p.name) + '<i class="ap">' + COC.chase.remaining(p) + '</i></span>';
        }).join('') + '</div>' +
      '</div>';
    }).join('');
  }

  function hazardChipHTML(h) {
    var label = (h.kind === 'obstacle' ? '■ ' : '▲ ') + (h.short || h.name);
    return '<span class="hazard-chip' + (h.kind === 'obstacle' ? ' is-obstacle' : '') + (h.cleared ? ' is-cleared' : '') +
      '" data-act="hazard" data-hid="' + h.hid + '" title="' + esc(h.name + ' · ' + COC.chase.difficultyLabel(h.difficulty)) + '">' + esc(label) + '</span>';
  }

  function actorRowHTML(p, chase, active, idx) {
    var rem = COC.chase.remaining(p);
    var pips = '';
    for (var i = 0; i < p.apBase; i++) pips += '<span class="pip' + (i < rem ? ' on' : '') + '"></span>';
    var isVeh = p.kind === 'vehicle';
    var hpText = isVeh
      ? '<span>体格 ' + COC.chase.vehicleState(p).buildNow + '</span>'
      : '<span>HP ' + p.hp + '/' + p.hpMax + '</span>';
    var flags = '';
    if (p.debt > 0) flags += '<span class="badge">欠账 ' + p.debt + '</span>';
    if (p.passengerOf) flags += '<span class="badge passenger">乘客</span>';
    if (isVeh && COC.chase.vehicleState(p).damaged) flags += '<span class="badge">损坏</span>';
    if (p.movBase !== p.mov) flags += '<span class="badge">MOV ' + (p.mov > p.movBase ? '+' : '') + (p.mov - p.movBase) + '</span>';
    if (rem === 0) flags += '<span class="badge">行动点用尽</span>';
    if (chase.hazards.some(function (h) { return h.edge === p.loc + 1 && h.kind === 'obstacle' && !h.cleared; })) {
      flags += '<span class="badge">受阻</span>';
    }
    if (chase.parts.some(function (x) { return x.pid !== p.pid && x.loc === p.loc; })) {
      flags += '<span class="badge chaser">接触</span>';
    }

    return '<div class="actor' + (active && active.pid === p.pid ? ' is-active' : '') + '" data-act="select-actor" data-pid="' + p.pid + '">' +
      '<div class="turn-mark">' + (idx + 1) + '</div>' +
      '<div><div class="name">' + esc(p.name) +
        '<span class="badge ' + p.role + '">' + (p.role === 'escapee' ? '逃离' : '追逐') + '</span>' + flags + '</div>' +
        '<div class="meta"><span>MOV ' + p.mov + '</span><span>DEX ' + p.dex + '</span>' +
        '<span>地点 ' + p.loc + '</span>' + hpText + '</div></div>' +
      '<div class="right"><div class="ap-pips">' + pips + '</div><div>' + rem + ' / ' + p.apBase + ' AP</div></div>' +
    '</div>';
  }

  function tieHTML(chase) {
    if (!chase.ties || !chase.ties.length) return '';
    return '<p class="hint warn" style="margin-top:10px">存在同敏捷的参与者，需要敏捷对抗检定决定先后。' +
      '<button class="btn tiny" data-act="tie">解决同敏捷</button></p>';
  }

  function actionPanelHTML(chase, active) {
    if (!active) {
      return '<div class="panel"><div class="panel-head"><h3>行动</h3></div><p class="hint">当前没有可行动的角色。</p></div>';
    }
    var rem = COC.chase.remaining(active);
    var isVeh = active.kind === 'vehicle';
    var isPassenger = !!active.passengerOf;
    var dis = function (cond) { return cond ? ' disabled' : ''; };
    var hpPct = isVeh
      ? Math.round((COC.chase.vehicleState(active).buildNow / Math.max(1, active.build)) * 100)
      : Math.round((active.hp / Math.max(1, active.hpMax)) * 100);

    var buttons =
      '<button class="btn" data-act="move1"' + dis(rem < 1 || isPassenger || !!chase.pendingMove) + '>移动 1 地点</button>' +
      (isVeh ? '<button class="btn" data-act="accelerate"' + dis(rem < 1 || isPassenger || !!chase.pendingMove) + '>猛踩油门</button>' : '') +
      '<button class="btn" data-act="attack"' + dis(false) + '>攻击 / 战技</button>' +
      '<button class="btn" data-act="resolve-hazard">结算险境</button>' +
      (isVeh ? '<button class="btn" data-act="accident">交通事故</button>' : '') +
      '<button class="btn ghost" data-act="adjust-ap">调整行动点</button>' +
      '<button class="btn primary" data-act="next-turn">结束回合</button>';

    var detail =
      '<div class="actor-detail">' +
        '<div class="detail-grid">' +
          '<div class="detail-item"><span>' + (isVeh ? '体格' : '生命值') + '</span><b>' +
            (isVeh ? COC.chase.vehicleState(active).buildNow + ' / ' + active.build : active.hp + ' / ' + active.hpMax) + '</b></div>' +
          '<div class="detail-item"><span>行动点</span><b>' + rem + ' / ' + active.apBase + '</b></div>' +
          '<div class="detail-item"><span>MOV</span><b>' + active.mov + '</b></div>' +
          '<div class="detail-item"><span>地点</span><b>' + active.loc + ' · ' + esc(chase.locations[active.loc].name) + '</b></div>' +
          '<div class="detail-item"><span>DEX</span><b>' + active.dex + '</b></div>' +
          '<div class="detail-item"><span>体格 Build</span><b>' + active.build + '</b></div>' +
        '</div>' +
        '<div class="hpbar' + (isVeh ? ' veh' : '') + '" style="margin-top:10px"><i style="width:' + Math.max(0, Math.min(100, hpPct)) + '%"></i></div>' +
        '<div style="margin-top:10px">' +
          (isVeh ? '' : '<label class="inline-field">乘客所属载具：<select data-act="set-carrier">' +
            '<option value="">— 独立行动 —</option>' +
            chase.parts.filter(function (x) { return x.kind === 'vehicle'; }).map(function (v) {
              return '<option value="' + v.pid + '"' + (active.passengerOf === v.pid ? ' selected' : '') + '>' + esc(v.name) + '</option>';
            }).join('') + '</select></label>') +
        '</div>' +
      '</div>';

    var recent = st().log.slice(-6).reverse().map(function (e) {
      return '<div class="line"><span class="r">' + (e.round ? 'R' + e.round : '—') + '</span>' + esc(e.text) + '</div>';
    }).join('');

    return '<div class="panel">' +
      '<div class="panel-head"><h3>行动</h3><span class="sub">' + esc(active.name) + ' · 剩余 ' + rem + ' AP</span></div>' +
      '<div class="action-grid">' + buttons + '</div>' +
      detail +
      '<div class="mini-log">' + (recent || '<div class="line muted">暂无记录</div>') + '</div>' +
    '</div>';
  }

  function endPanelHTML(chase) {
    var lines = chase.parts.map(function (p) {
      return '<div class="row"><span>' + esc(p.name) + ' · 地点 ' + p.loc + '</span><b>' +
        (p.kind === 'vehicle' ? '体格 ' + COC.chase.vehicleState(p).buildNow : 'HP ' + p.hp + '/' + p.hpMax) + '</b></div>';
    }).join('');
    return '<div class="panel"><div class="panel-head"><h3>追逐结束</h3></div>' +
      '<div class="summary">' + lines + '</div>' +
      '<p class="hint">记录会保留在日志页签中；点击「新建追逐」可开始下一场。</p></div>';
  }

  function toolsPanelHTML(chase) {
    var open = !!ui.toolsOpen;
    return '<div class="panel">' +
      '<div class="panel-head"><h3>工具</h3><span class="sub">常用三项；进阶规则默认收起</span></div>' +
      '<div class="action-grid">' +
        '<button class="btn tool-btn" data-act="random-peril">随机险境<small>想不出险境时，骰 1D100 定难度</small></button>' +
        '<button class="btn tool-btn" data-act="hide">躲藏 / 结束追逐<small>潜行对抗侦查，成功即脱离</small></button>' +
        '<button class="btn tool-btn" data-act="join-chase">中途加入<small>有人半途加入这场追逐</small></button>' +
      '</div>' +
      '<div class="more-head" style="margin-top:12px">' +
        '<button class="btn tiny ghost" data-act="toggle-tools">' + (open ? '▾ ' : '▸ ') + '进阶规则（5 项）</button>' +
        '<span class="muted">突发险境、人为制造险境、更换移动方式、乘客援助、分头行动</span>' +
      '</div>' +
      '<div id="toolsAdv"' + (open ? '' : ' hidden') + '>' +
        '<div class="action-grid" style="margin-top:10px">' +
          '<button class="btn tool-btn" data-act="sudden">突发险境<small>团体幸运检定后临时插入</small></button>' +
          '<button class="btn tool-btn" data-act="craft-peril">人为制造险境<small>锁门、掀摊、鸣枪等</small></button>' +
          '<button class="btn tool-btn" data-act="change-mode">更换移动方式<small>步行 / 游泳 / 载具切换</small></button>' +
          '<button class="btn tool-btn" data-act="aid">乘客援助<small>乘客协助驾驶，减少惩罚骰</small></button>' +
          '<button class="btn tool-btn" data-act="split">分头行动<small>拆成两场独立的追逐</small></button>' +
        '</div>' +
        '<p class="hint" style="margin-top:8px">突发险境下一次由：' +
          (chase.suddenNext === 'players' ? '玩家' : '守秘人') + ' 提出。</p>' +
      '</div>' +
    '</div>';
  }

  /* ---------------- 建立追逐流程 ---------------- */

  function openPicker(mode) {
    var chars = st().chars;
    if (!chars.length) { toast('角色卡库为空，请先新建角色', 'bad'); return; }
    var rows = chars.map(function (c) {
      var base = baseMov(c);
      return setupRowHTML(c.name,
        COC.store.KIND_LABEL[c.kind] + ' · MOV ' + base + (c.kind === 'vehicle' ? ' · 体格 ' + c.vehicle.build : ' · DEX ' + c.dex),
        (mode === 'join'
          ? '<button class="btn tiny" data-pick="chaser" data-id="' + c.id + '">作为追逐者加入</button>' +
            '<button class="btn tiny" data-pick="escapee" data-id="' + c.id + '">作为逃离者加入</button>'
          : '<button class="btn tiny" data-pick="chaser" data-id="' + c.id + '">追逐者</button>' +
            '<button class="btn tiny" data-pick="escapee" data-id="' + c.id + '">逃离者</button>'));
    }).join('');

    openModal({
      title: mode === 'join' ? '中途加入追逐' : '添加参与者',
      sub: '从角色卡库选择，并指定其角色',
      body: '<div class="setup-list">' + rows + '</div>',
      foot: '<button class="btn" data-close>取消</button>'
    });

    modalRoot.querySelectorAll('[data-pick]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cid = btn.dataset.id;
        var role = btn.dataset.pick;
        if (mode === 'join') addToChase(cid, role);
        else {
          var setup = ensureSetup();
          setup.entries.push({ charId: cid, role: role, mov: null, checked: false });
          save();
          renderChase();
          toast('已加入名单');
        }
        closeModal();
      });
    });
  }

  function addToChase(cid, role) {
    var chase = st().chase;
    var c = COC.store.getChar(cid);
    if (!chase || !c) return;
    var p = COC.chase.snapshot(c, role);
    var same = chase.parts.filter(function (x) { return x.role === role; });
    p.loc = same.length ? Math.min.apply(null, same.map(function (x) { return x.loc; })) : 0;
    chase.parts.push(p);
    chase.order = COC.chase.sortByDex(chase.parts).map(function (x) { return x.pid; });
    COC.chase.addTiesFor(chase, p);
    chase.minMov = COC.chase.recalcAP(chase.parts);
    log('中途加入：' + p.name + ' 作为' + (role === 'escapee' ? '逃离者' : '追逐者') + '，MOV ' + p.mov);
    save();
    renderAll();
    toast(p.name + ' 已加入追逐');
  }

  function openSpeedCheck(i) {
    var setup = ensureSetup();
    var entry = setup.entries[i];
    if (!entry) return;
    var c = COC.store.getChar(entry.charId);
    if (!c) { toast('角色卡不存在', 'bad'); return; }
    var isVeh = c.kind === 'vehicle';
    var base = baseMov(c);
    var skillKey = isVeh ? COC.chase.vehicleSkill(c) : null;
    var threshold = isVeh ? (c.skills[skillKey] || 0) : (c.con || 0);
    var skillLabel = isVeh ? COC.store.SKILLS[skillKey] : '体质（CON）';

    openModal({
      title: '速度检定 · ' + c.name,
      sub: '极难成功 MOV +1；成功不变；失败 MOV −1（P112）',
      body:
        '<div class="summary">' +
          kvRow('基础 MOV', base) +
          kvRow('检定技能', skillLabel + ' ' + threshold + '%') +
        '</div>' +
        rollFields('sp', threshold, 0, 0) +
        '<div id="spResult"></div>' +
        '<p class="hint">若受到阻碍（如翻窗、被门挡住），KP 可在此追加奖励骰或惩罚骰。</p>',
      foot: '<button class="btn" data-close>取消</button><button class="btn primary" id="spRoll">掷骰</button>'
    });

    document.getElementById('spRoll').addEventListener('click', function () {
      var r = readRoll('sp');
      entry.checked = true;
      entry.levelKey = r.levelKey;
      entry.levelLabel = r.level;
      entry.mov = COC.chase.movAdjust(base, r.levelKey);
      COC.store.log('速度检定 ' + c.name + '：' + r.value + ' ' + r.level + ' → MOV ' + base + ' → ' + entry.mov);
      save();
      document.getElementById('spResult').innerHTML = checkHTML(r, skillLabel) +
        '<div class="result-banner info">MOV：' + base + ' → <b>' + entry.mov + '</b></div>';
      renderChase();
    });
  }

  function startChase() {
    var setup = ensureSetup();
    var res = COC.chase.build(setup);
    if (res.error) { toast(res.error, 'bad'); return; }
    if (res.escapedOnly) {
      log('追逐未建立：' + res.escaped.map(function (p) { return p.name; }).join('、') + ' 的 MOV 高于所有追逐者，成功逃脱。');
      openModal({
        title: '追逐未建立',
        sub: 'P112 · 比较速度',
        body: '<div class="result-banner ok">逃离者速度高于所有追逐者，追逐在开始前就已结束。守秘人可以描述追逐者如何跟丢了猎物。</div>',
        foot: '<button class="btn primary" data-close>知道了</button>'
      });
      save();
      return;
    }
    var chase = res.chase;
    st().chase = chase;
    st().setup = null;
    var first = COC.chase.part(chase, chase.order[0]);
    COC.store.log('建立追逐「' + chase.name + '」：' + chase.parts.length + ' 名参与者，全场最低 MOV ' + chase.minMov + '，第 1 轮由 ' + (first ? first.name : '—') + ' 首先行动。');
    if (chase.escaped.length) COC.store.log('逃脱：' + chase.escaped.join('、') + ' 的速度高于所有追逐者。');
    if (chase.dropped.length) COC.store.log('落后：' + chase.dropped.join('、') + ' 慢于最慢的逃离者，未能参与追逐。');
    save();
    ui.tab = 'chase';
    renderAll();
    toast('追逐已建立');
  }

  /* ---------------- 追逐中的移动与行动 ---------------- */

  function active() {
    var chase = st().chase;
    return chase ? COC.chase.activePart(chase) : null;
  }

  function moveActor(steps, accelerate) {
    var chase = st().chase;
    var p = active();
    if (!chase || !p || chase.ended) return;
    if (chase.pendingMove) { toast('请先结算当前险境或障碍', 'bad'); return; }
    if (p.passengerOf) { toast('乘客不能自行移动', 'bad'); return; }
    if (COC.chase.remaining(p) < 1) { toast('行动点不足，请结束回合', 'bad'); return; }
    COC.chase.spend(p, 1);
    var penalty = accelerate ? (steps <= 3 ? 1 : 2) : 0;
    if (accelerate && chase.aid) {
      penalty = Math.max(0, penalty - 1);
      chase.aid = false;
      COC.store.log('乘客援助生效：本次加速少承受 1 个惩罚骰。');
    }
    chase.pendingMove = {
      pid: p.pid,
      remaining: steps,
      moved: 0,
      penalty: penalty,
      accelerate: !!accelerate,
      startLoc: p.loc
    };
    continueMove();
  }

  /* 逐地点推进；遇到障碍或险境即暂停，结算成功后再继续剩余距离 */
  function continueMove() {
    var chase = st().chase;
    var pm = chase && chase.pendingMove;
    if (!pm) return;
    var p = COC.chase.part(chase, pm.pid);
    if (!p) { chase.pendingMove = null; save(); renderChase(); return; }

    var last = chase.locations.length - 1;
    var hazardHit = null;
    while (pm.remaining > 0 && p.loc < last) {
      var edge = p.loc + 1;
      var hs = COC.chase.hazardsOnEdge(chase, edge);
      var obstacle = hs.filter(function (h) { return h.kind === 'obstacle' && !h.cleared; })[0];
      if (obstacle) { hazardHit = obstacle; break; }
      p.loc = edge;
      pm.moved += 1;
      pm.remaining -= 1;
      var peril = hs.filter(function (h) { return h.kind === 'peril'; })[0];
      if (peril) { hazardHit = peril; break; }
    }

    save();
    renderChase();

    if (hazardHit) {
      openHazardResolve(hazardHit.hid, p.pid, {
        penalty: pm.penalty,
        onDone: function (success) {
          var still = chase.pendingMove;
          if (!still) return;
          if (success) continueMove();
          else finishMove(false);
        }
      });
    } else {
      finishMove(true);
    }
  }

  function finishMove(completed) {
    var chase = st().chase;
    var pm = chase && chase.pendingMove;
    if (!pm) return;
    var p = COC.chase.part(chase, pm.pid);
    if (p) {
      var distance = p.loc - pm.startLoc;
      COC.store.log((pm.accelerate ? '加速移动' : '移动') + '：' + p.name + ' 从地点 ' + pm.startLoc +
        (distance > 0 ? ' 前进 ' + distance + ' 个地点' : ' 未能前进') +
        (completed ? '，到达地点 ' + p.loc + '。' : '，移动中止于地点 ' + p.loc + '。'));
      if (completed && p.loc >= chase.locations.length - 1) toast('已到达地点轨末端，可添加新地点');
    }
    chase.pendingMove = null;
    save();
    renderChase();
  }

  function openAccelerate() {
    var p = active();
    var chase = st().chase;
    if (!p) return;
    var env = prefs().env || 'suburb';
    var visibility = COC.tables.visibility;
    openModal({
      title: '猛踩油门 · ' + p.name,
      sub: '1 点行动点移动多个地点；必须移动前声明，不可更改（P118–119）',
      body:
        '<div class="form-grid">' +
          '<label class="field"><span>移动距离</span><select id="acSteps">' +
            '<option value="2">2 个地点（险境 1 惩罚骰）</option>' +
            '<option value="3">3 个地点（险境 1 惩罚骰）</option>' +
            '<option value="4">4 个地点（险境 2 惩罚骰）</option>' +
            '<option value="5">5 个地点（险境 2 惩罚骰）</option>' +
          '</select></label>' +
          '<label class="field"><span>视野环境</span><select id="acEnv">' +
            visibility.map(function (v) {
              return '<option value="' + v.key + '"' + (env === v.key ? ' selected' : '') + '>' + esc(v.env) + ' · ' + v.dice + '</option>';
            }).join('') +
          '</select></label>' +
        '</div>' +
        '<p class="hint">加速带来的惩罚骰只作用于险境，不影响破坏障碍。当前视野：<b id="acVis">—</b> 个地点。</p>',
      foot: '<button class="btn" data-close>取消</button><button class="btn primary" id="acGo">确认并移动</button>'
    });
    function updateVis() {
      var e = val('acEnv');
      var rowVis = visibility.filter(function (v) { return v.key === e; })[0] || visibility[0];
      document.getElementById('acVis').textContent = COC.dice.roll(rowVis.dice).total;
    }
    document.getElementById('acEnv').addEventListener('change', updateVis);
    updateVis();
    document.getElementById('acGo').addEventListener('click', function () {
      prefs().env = val('acEnv');
      var steps = parseInt(val('acSteps'), 10) || 2;
      closeModal();
      moveActor(steps, true);
    });
  }

  /* ---------------- 险境与障碍 ---------------- */

  function openHazardEditor(prefill) {
    prefill = prefill || {};
    var chase = st().chase;
    if (!chase) { toast('请先建立追逐', 'bad'); return; }
    var edges = [];
    for (var i = 1; i < chase.locations.length; i++) {
      edges.push('<option value="' + i + '"' + (prefill.edge === i ? ' selected' : '') + '>' +
        esc(chase.locations[i - 1].name) + ' → ' + esc(chase.locations[i].name) + '</option>');
    }
    var skillChecks = COC.tables.hazardSkills.map(function (s, idx) {
      return '<label class="inline-field"><input type="checkbox" data-hskill="' + s.key + '"' +
        (prefill.skills && prefill.skills.indexOf(s.key) >= 0 ? ' checked' : '') +
        ((!prefill.skills && idx < 4) ? ' checked' : '') + '> ' + s.label + '</label>';
    }).join(' ');

    openModal({
      title: '放置险境 / 障碍',
      sub: '险境与障碍位于两个地点之间（P114–116）',
      wide: true,
      body:
        '<div class="form-grid">' +
          '<label class="field"><span>位置（跨越的地点）</span><select id="hzEdge">' + edges.join('') + '</select></label>' +
          '<label class="field"><span>类型</span><select id="hzKind">' +
            '<option value="peril">险境（可通过但可能受伤 / 拖延）</option>' +
            '<option value="obstacle">障碍（未越过前阻挡前进）</option>' +
          '</select></label>' +
          '<label class="field"><span>名称</span><input id="hzName" type="text" value="' + esc(prefill.name || '') + '" placeholder="如：泥沼、锁住的铁门"></label>' +
          '<label class="field"><span>难度</span><select id="hzDiff">' +
            '<option value="regular">普通</option><option value="hard">困难</option><option value="extreme">极难</option>' +
          '</select></label>' +
          '<label class="field"><span>障碍耐久（仅障碍）</span><input id="hzDur" type="number" min="1" max="200" value="' + (prefill.dur || 10) + '"></label>' +
          '<label class="field"><span>耐久参考</span><select id="hzDurPreset"><option value="">— 选择预设 —</option>' +
            COC.tables.obstaclePresets.map(function (o) {
              return '<option value="' + o.dur + '">' + esc(o.name) + ' · ' + o.dur + '</option>';
            }).join('') + '</select></label>' +
        '</div>' +
        '<div class="panel" style="padding:12px"><div class="panel-head" style="margin-bottom:8px"><h3>可用技能</h3></div>' +
          '<div class="chips">' + skillChecks + '</div>' +
          '<p class="hint">KP 可裁定其他技能或属性；玩家也可提出自己的方案（P114）。</p>' +
        '</div>',
      foot: '<button class="btn" data-close>取消</button><button class="btn primary" id="hzCreate">放置</button>'
    });

    if (prefill.difficulty) document.getElementById('hzDiff').value = prefill.difficulty;
    if (prefill.kind) document.getElementById('hzKind').value = prefill.kind;

    document.getElementById('hzDurPreset').addEventListener('change', function () {
      if (this.value) document.getElementById('hzDur').value = this.value;
    });

    document.getElementById('hzCreate').addEventListener('click', function () {
      var name = val('hzName').trim();
      if (!name) { toast('请填写险境名称', 'bad'); return; }
      var skills = [];
      document.querySelectorAll('[data-hskill]').forEach(function (cb) {
        if (cb.checked) skills.push(cb.dataset.hskill);
      });
      if (!skills.length) skills = ['dodge'];
      var kind = val('hzKind');
      var dur = Math.max(1, parseInt(val('hzDur'), 10) || 10);
      var h = {
        hid: COC.store.uid(),
        edge: parseInt(val('hzEdge'), 10) || 1,
        kind: kind,
        name: name,
        difficulty: val('hzDiff'),
        skills: skills,
        durability: kind === 'obstacle' ? dur : null,
        maxDur: kind === 'obstacle' ? dur : null,
        cleared: false
      };
      chase.hazards.push(h);
      COC.store.log('放置' + (kind === 'obstacle' ? '障碍' : '险境') + '「' + name + '」于地点 ' + (h.edge - 1) + ' → ' + h.edge + '，难度' + COC.chase.difficultyLabel(h.difficulty) + '。');
      save();
      renderChase();
      closeModal();
      toast('已放置：' + name);
    });
  }

  function openHazardChoose() {
    var chase = st().chase;
    var p = active();
    if (!chase || !p) return;
    var list = chase.hazards.filter(function (h) {
      return h.edge === p.loc || h.edge === p.loc + 1;
    });
    if (!list.length) { toast('当前位置附近没有险境或障碍'); return; }
    openModal({
      title: '结算险境',
      sub: '选择要结算的险境；角色位于其前一个地点或已跨过时适用',
      body: '<div class="setup-list">' + list.map(function (h) {
        return setupRowHTML(h.name,
          (h.kind === 'obstacle' ? '障碍 · 耐久 ' + h.durability : '险境') + ' · ' + COC.chase.difficultyLabel(h.difficulty) +
          ' · 地点 ' + (h.edge - 1) + ' → ' + h.edge,
          '<button class="btn tiny primary" data-hz="' + h.hid + '">结算</button>');
      }).join('') + '</div>',
      foot: '<button class="btn" data-close>取消</button>'
    });
    modalRoot.querySelectorAll('[data-hz]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var hid = btn.dataset.hz;
        closeModal();
        openHazardResolve(hid, p.pid, {});
      });
    });
  }

  function openHazardResolve(hid, pid, opts) {
    opts = opts || {};
    var chase = st().chase;
    var h = chase.hazards.filter(function (x) { return x.hid === hid; })[0];
    var p = COC.chase.part(chase, pid);
    if (!h || !p) return;
    var factor = COC.chase.factor(h.difficulty);
    var skillOpts = h.skills.map(function (key) {
      var meta = COC.tables.hazardSkills.filter(function (s) { return s.key === key; })[0];
      var label = meta ? meta.label : key;
      return '<option value="' + key + '">' + label + ' ' + COC.chase.skillValue(p, key) + '%</option>';
    }).join('');
    var firstKey = h.skills[0] || 'dodge';
    var threshold = Math.floor(COC.chase.skillValue(p, firstKey) * factor);
    var isVeh = p.kind === 'vehicle';
    var damagedVehicle = isVeh && COC.chase.vehicleState(p).damaged;
    var basePenalty = Math.min(2, (opts.penalty || 0) + (damagedVehicle ? 1 : 0));

    openModal({
      title: (h.kind === 'obstacle' ? '越过障碍 · ' : '越过险境 · ') + h.name,
      sub: COC.chase.difficultyLabel(h.difficulty) + '难度 · ' + p.name + ' · 地点 ' + (h.edge - 1) + ' → ' + h.edge,
      wide: true,
      body:
        '<div class="summary">' +
          kvRow('类型', h.kind === 'obstacle' ? '障碍' : '险境') +
          (h.kind === 'obstacle' ? kvRow('剩余耐久', '<span id="hzDurNow">' + h.durability + ' / ' + h.maxDur + '</span>') : '') +
          kvRow('可用技能', h.skills.map(function (k) {
            var meta = COC.tables.hazardSkills.filter(function (s) { return s.key === k; })[0];
            return meta ? meta.label : k;
          }).join('、')) +
        '</div>' +
        (h.kind === 'obstacle'
          ? '<div class="panel" style="padding:12px">' +
              '<div class="panel-head" style="margin-bottom:8px"><h3>破坏障碍</h3><span class="sub">P115–116</span></div>' +
              '<div class="form-grid">' +
                '<label class="field"><span>本次造成的伤害</span><input id="hzBreakVal" type="number" min="0" placeholder="输入伤害值"></label>' +
                (isVeh ? '<label class="field"><span>载具撞击</span><button class="btn" id="hzRam">体格 ' + p.build + ' × 1D10</button></label>'
                       : '<label class="field"><span>提示</span><input type="text" readonly value="角色可用蛮力，KP 裁定伤害"></label>') +
              '</div>' +
              '<button class="btn danger wide" id="hzBreak" style="margin-top:8px">累计破坏伤害</button>' +
              '<p class="hint">耐久归零后障碍消失；载具撞毁障碍会承受原耐久一半的伤害，未摧毁则载具失事。</p>' +
            '</div>'
          : '') +
        '<div class="form-grid">' +
          '<label class="field"><span>使用技能 / 属性</span><select id="hzSkill">' + skillOpts + '</select></label>' +
          '<label class="field"><span>难度</span><select id="hzDiff">' +
            '<option value="regular"' + (h.difficulty === 'regular' ? ' selected' : '') + '>普通（阈值 = 技能）</option>' +
            '<option value="hard"' + (h.difficulty === 'hard' ? ' selected' : '') + '>困难（1/2）</option>' +
            '<option value="extreme"' + (h.difficulty === 'extreme' ? ' selected' : '') + '>极难（1/5）</option>' +
          '</select></label>' +
          '<label class="field"><span>谨慎行动</span><select id="hzBuy">' +
            '<option value="0">不额外消耗行动点</option>' +
            '<option value="1">花费 1 点行动点 · +1 奖励骰</option>' +
            '<option value="2">花费 2 点行动点 · +2 奖励骰</option>' +
          '</select></label>' +
          '<label class="field"><span>当前剩余行动点</span><input id="hzRem" type="text" value="' + COC.chase.remaining(p) + '" readonly></label>' +
        '</div>' +
        rollFields('hzc', threshold, 0, basePenalty) +
        (damagedVehicle ? '<p class="hint warn">载具体格已低于原值一半：本次驾驶检定自动附加 1 个惩罚骰（P122）。</p>' : '') +
        '<div id="hzOut"></div>',
      foot: '<button class="btn ghost danger" id="hzRemove">移除</button>' +
        '<button class="btn" data-close>稍后</button><button class="btn primary" id="hzRoll">掷骰</button>'
    });

    document.getElementById('hzRemove').addEventListener('click', function () {
      if (!window.confirm('从地点轨移除' + (h.kind === 'obstacle' ? '障碍' : '险境') + '「' + h.name + '」？')) return;
      chase.hazards = chase.hazards.filter(function (x) { return x.hid !== hid; });
      COC.store.log('移除' + (h.kind === 'obstacle' ? '障碍' : '险境') + '「' + h.name + '」（地点 ' + (h.edge - 1) + ' → ' + h.edge + '）。');
      var done = opts.onDone;
      opts.onDone = null;
      save();
      renderChase();
      closeModal();
      if (done) done(false);
    });

    if (opts.onDone) {
      registerCloseHook(function () {
        var done = opts.onDone;
        opts.onDone = null;
        if (done) done(false);
      });
    }

    var diffSel = document.getElementById('hzDiff');
    var skillSel = document.getElementById('hzSkill');
    function updateThreshold() {
      var key = skillSel.value;
      var f = COC.chase.factor(diffSel.value);
      document.getElementById('hzcThr').value = Math.floor(COC.chase.skillValue(p, key) * f);
    }
    skillSel.addEventListener('change', updateThreshold);
    diffSel.addEventListener('change', updateThreshold);

    function damageObstacle(amount, ram) {
      if (!h || h.kind !== 'obstacle' || h.durability == null) return;
      amount = Math.max(0, Math.round(amount));
      h.durability = Math.max(0, h.durability - amount);
      var durEl = document.getElementById('hzDurNow');
      if (durEl) durEl.textContent = h.durability + ' / ' + h.maxDur;
      COC.store.log('破坏障碍「' + h.name + '」：造成 ' + amount + ' 点伤害，剩余耐久 ' + h.durability + ' / ' + h.maxDur + '。');
      if (h.durability === 0) {
        h.cleared = true;
        COC.store.log('障碍「' + h.name + '」被摧毁，残留碎片可视为一处险境。');
        if (ram) {
          var back = Math.floor(h.maxDur / 2);
          var out = COC.chase.applyDamage(p, back);
          COC.store.log('载具撞毁障碍后承受反冲 ' + back + ' 点伤害' +
            (out.type === 'vehicle' ? '（体格损失 ' + out.buildLoss + '）' : '（HP ' + out.hp + '）') + '。');
        }
        toast('障碍已摧毁');
      } else if (ram) {
        COC.store.log('载具撞击障碍但未能摧毁，载具失事——请按交通事故结算。');
        toast('载具失事：请结算交通事故', 'bad');
      }
      save();
      renderChase();
      var rollBtn = document.getElementById('hzRoll');
      if (rollBtn) rollBtn.disabled = h.cleared;
      if (h.durability === 0 && opts.onDone) {
        if (p.loc < h.edge) { p.loc = h.edge; save(); renderChase(); }
        var done = opts.onDone;
        opts.onDone = null;
        closeModal();
        done(true);
      }
    }

    var breakBtn = document.getElementById('hzBreak');
    if (breakBtn) {
      breakBtn.addEventListener('click', function () {
        damageObstacle(parseInt(val('hzBreakVal'), 10) || 0, false);
      });
    }
    var ramBtn = document.getElementById('hzRam');
    if (ramBtn) {
      ramBtn.addEventListener('click', function () {
        var roll = COC.dice.roll(COC.chase.vehicleAttackDice(p));
        COC.store.log(p.name + ' 以载具撞击「' + h.name + '」：' + diceNote(roll) + ' 点伤害。');
        damageObstacle(roll.total, true);
        this.disabled = true;
      });
    }

    var rolled = false;
    document.getElementById('hzRoll').addEventListener('click', function () {
      if (rolled) return;
      var buy = parseInt(val('hzBuy'), 10) || 0;
      if (buy > 0) {
        if (COC.chase.remaining(p) < buy) { toast('行动点不足，无法换取奖励骰', 'bad'); return; }
        COC.chase.spend(p, buy);
      }
      var bonusEl = document.getElementById('hzcBonus');
      bonusEl.value = Math.min(2, (parseInt(bonusEl.value, 10) || 0) + buy);
      var r = readRoll('hzc');
      rolled = true;
      this.disabled = true;
      COC.store.log('险境「' + h.name + '」：' + p.name + ' ' + r.value + ' ' + r.level + '（阈值 ' + r.threshold + '%' +
        (r.manual ? '，手动录入' : '') + '）。');
      save();

      var success = r.rank >= 2;
      var out = checkHTML(r, skillSel.value);
      if (success) {
        if (h.kind === 'obstacle') h.cleared = true;
        out += '<div class="result-banner ok">越过成功' + (h.kind === 'obstacle' ? '，障碍已被越过' : '，未被拖延或伤害') + '。</div>' +
          '<button class="btn primary wide" id="hzDone" style="margin-top:10px">确认并移动到地点 ' + h.edge + '</button>';
      } else {
        var dmgOpts = isVeh
          ? COC.tables.accidents.map(function (a) { return '<option value="' + a.dice + '" data-name="' + a.name + '">' + a.name + ' · ' + a.dice + '</option>'; }).join('')
          : COC.tables.damageLevels.map(function (d) {
              return '<option value="' + (d.dice || '0') + '" data-name="' + d.name + '">' + d.name + ' · ' + (d.dice || '无伤害') + '</option>';
            }).join('');
        out += '<div class="result-banner bad">检定失败：可能受伤并被拖延（1D3 行动点）。</div>' +
          '<div class="form-grid" style="margin-top:10px">' +
            '<label class="field"><span>' + (isVeh ? '交通事故等级' : '伤害等级（表Ⅲ）') + '</span><select id="hzDmg">' + dmgOpts + '</select></label>' +
          '</div>' +
          '<button class="btn danger wide" id="hzApply" style="margin-top:10px">结算伤害与 1D3 行动点损失</button>';
      }
      document.getElementById('hzOut').innerHTML = out;

      if (success) {
        document.getElementById('hzDone').addEventListener('click', function () {
          if (p.loc < h.edge) p.loc = h.edge;
          COC.store.log(p.name + ' 越过' + (h.kind === 'obstacle' ? '障碍' : '险境') + '「' + h.name + '」，到达地点 ' + p.loc + '。');
          var done = opts.onDone;
          opts.onDone = null;
          save();
          renderChase();
          closeModal();
          if (done) done(true);
        });
      } else {
        document.getElementById('hzApply').addEventListener('click', function () {
          var sel = document.getElementById('hzDmg');
          var expr = sel.value;
          var dmgName = sel.options[sel.selectedIndex].dataset.name;
          var dmgRoll = expr === '0' ? { total: 0, rolls: [] } : COC.dice.roll(expr);
          var out2;
          if (dmgRoll.total > 0) out2 = COC.chase.applyDamage(p, dmgRoll.total);
          else out2 = { type: isVeh ? 'vehicle' : 'character', amount: 0 };
          var apLoss = COC.dice.roll('1D3');
          COC.chase.loseAP(p, apLoss.total);
          COC.store.log(p.name + ' 在险境「' + h.name + '」失败：' + dmgName + ' ' + (expr === '0' ? '无伤害' : diceNote(dmgRoll)) +
            (out2.type === 'character' ? '，HP ' + out2.hp + '/' + out2.hpMax : '，体格损失 ' + (out2.buildLoss || 0)) +
            '，另损失 ' + apLoss.total + ' 点行动点。' + (h.kind === 'obstacle' ? '障碍仍未被越过。' : ''));
          var done = opts.onDone;
          opts.onDone = null;
          save();
          renderChase();
          closeModal();
          toast('已结算：' + dmgName);
          if (done) done(false);
        });
      }
    });
  }

  /* ---------------- 攻击与战技 ---------------- */

  function openCombat() {
    var chase = st().chase;
    var p = active();
    if (!chase || !p || chase.ended) return;
    if (COC.chase.remaining(p) < 1) { toast('攻击需要 1 点行动点', 'bad'); return; }
    var others = chase.parts.filter(function (x) { return x.pid !== p.pid; });
    var isVeh = p.kind === 'vehicle';
    var atkKey = isVeh ? COC.chase.vehicleSkill(p) : 'fight';
    var atkVal = COC.chase.skillValue(p, atkKey);

    openModal({
      title: '攻击 / 战技 · ' + p.name,
      sub: '攻击消耗 1 行动点；只能攻击同一地点，持火器可跨地点（P116）',
      wide: true,
      body:
        '<div class="form-grid">' +
          '<label class="field"><span>目标</span><select id="cbTarget">' + others.map(function (x) {
            return '<option value="' + x.pid + '">' + esc(x.name) + ' · 地点 ' + x.loc + ' · 体格 ' + x.build + '</option>';
          }).join('') + '</select></label>' +
          '<label class="field"><span>攻击方式</span><select id="cbMode">' +
            '<option value="normal">普通攻击</option><option value="maneuver">战技（摔绊 / 撞击 / 拽下）</option>' +
          '</select></label>' +
          '<label class="field"><span>射击方式</span><select id="cbMove">' +
            '<option value="0">停下射击（不额外惩罚）</option>' +
            '<option value="1">行进中射击（+1 惩罚骰）</option>' +
            '<option value="2">使用火器跨地点</option>' +
          '</select></label>' +
          '<label class="field"><span>体格对抗</span><input id="cbBuildNote" type="text" readonly value="—"></label>' +
        '</div>' +
        '<div class="form-grid">' +
          '<label class="field"><span>攻击方技能</span><input id="cbAtkThr" type="number" min="0" max="200" value="' + atkVal + '"></label>' +
          '<label class="field"><span>防御方技能</span><input id="cbDefThr" type="number" min="0" max="200" value="0"></label>' +
          '<label class="field"><span>奖励骰</span><input id="cbAtkBonus" type="number" min="0" max="2" value="0"></label>' +
          '<label class="field"><span>惩罚骰</span><input id="cbAtkPenalty" type="number" min="0" max="2" value="0"></label>' +
          (prefs().diceMode === 'manual'
            ? '<label class="field"><span>攻击骰（手动）</span><input id="cbAtkManual" type="number" min="1" max="100" value="50"></label>' +
              '<label class="field"><span>防御骰（手动）</span><input id="cbDefManual" type="number" min="1" max="100" value="50"></label>'
            : '') +
        '</div>' +
        '<p class="hint warn" id="cbWarn"></p>' +
        '<div id="cbOut"></div>',
      foot: '<button class="btn" data-close>取消</button><button class="btn primary" id="cbRoll">进行对抗检定</button>'
    });

    function target() {
      return COC.chase.part(chase, val('cbTarget'));
    }
    function refreshNote() {
      var t = target();
      if (!t) return;
      var diff = t.build - p.build;
      var mode = val('cbMode');
      var note;
      if (mode === 'maneuver') {
        if (diff >= 3) note = '目标体格高 ' + diff + ' → 战技不可能成功';
        else if (diff > 0) note = '目标体格高 ' + diff + ' → 攻击方承受 ' + diff + ' 惩罚骰';
        else note = '体格差 ' + diff + ' → 无惩罚骰';
      } else {
        note = '目标体格 ' + t.build + ' / 攻击方 ' + p.build;
      }
      document.getElementById('cbBuildNote').value = note;
      var defVal = t.kind === 'vehicle' ? (t.skills[COC.chase.vehicleSkill(t)] || 0) : (t.skills.dodge || 0);
      document.getElementById('cbDefThr').value = defVal;
      var warn = [];
      if (p.kind === 'vehicle' && COC.chase.vehicleState(p).damaged) warn.push('攻击方载具已损坏：驾驶检定 +1 惩罚骰');
      if (t.kind === 'vehicle' && COC.chase.vehicleState(t).damaged) warn.push('目标载具已损坏：防御检定 +1 惩罚骰');
      document.getElementById('cbWarn').textContent = warn.join('；');
    }
    document.getElementById('cbTarget').addEventListener('change', refreshNote);
    document.getElementById('cbMode').addEventListener('change', refreshNote);
    refreshNote();

    document.getElementById('cbRoll').addEventListener('click', function () {
      var t = target();
      if (!t) { toast('没有可选目标', 'bad'); return; }
      var mode = val('cbMode');
      var moveMode = val('cbMove');
      if (mode === 'maneuver' && t.build - p.build >= 3) {
        toast('体格差 3 点以上，战技不可能成功', 'bad');
        return;
      }
      if (moveMode !== '2' && t.loc !== p.loc) {
        toast('不同地点的目标无法近身攻击；请选择火器跨地点', 'bad');
        return;
      }
      if (COC.chase.remaining(p) < 1) { toast('行动点不足', 'bad'); return; }
      COC.chase.spend(p, 1);

      var penalty = (parseInt(val('cbAtkPenalty'), 10) || 0);
      var bonus = (parseInt(val('cbAtkBonus'), 10) || 0);
      if (mode === 'maneuver') {
        var diff = Math.max(0, t.build - p.build);
        penalty += Math.min(2, diff);
      }
      if (moveMode === '1') penalty += 1;
      if (p.kind === 'vehicle' && COC.chase.vehicleState(p).damaged) penalty += 1;
      var a = COC.dice.check(parseInt(val('cbAtkThr'), 10) || 0, {
        bonus: bonus, penalty: Math.min(2, penalty), manual: readManual('cbAtk')
      });
      var defPenalty = (t.kind === 'vehicle' && COC.chase.vehicleState(t).damaged) ? 1 : 0;
      var b = COC.dice.check(parseInt(val('cbDefThr'), 10) || 0, {
        bonus: 0, penalty: defPenalty, manual: (function () {
          var el = document.getElementById('cbDefManual');
          if (!el) return undefined;
          var n = parseInt(el.value, 10);
          return isNaN(n) ? undefined : n;
        })()
      });
      var opp = COC.dice.opposed(a, b);
      var win = opp.winner === 'a' && a.rank >= 2;
      var out = '<div class="form-grid">' +
        '<div>' + checkHTML(a, p.name + ' 攻击') + '</div>' +
        '<div>' + checkHTML(b, t.name + ' 防御') + '</div>' +
      '</div>';
      out += win
        ? '<div class="result-banner ok">' + p.name + ' 在对抗中获胜。</div>'
        : '<div class="result-banner bad">' +
          (a.rank < 2 ? '攻击方检定失败，本次攻击未命中。' : (opp.winner === 'tie' ? '双方平手，未造成效果。' : t.name + ' 防御成功。')) +
          '</div>';

      if (win) {
        var isVehTarget = t.kind === 'vehicle';
        var dmgSelect = '<select id="cbDmg">' +
          (isVehTarget
            ? COC.tables.accidents.map(function (x) { return '<option value="' + x.dice + '">' + x.name + ' · ' + x.dice + '</option>'; }).join('')
            : COC.tables.damageLevels.map(function (x) { return '<option value="' + (x.dice || '0') + '">' + x.name + ' · ' + (x.dice || '无伤害') + '</option>'; }).join('')) +
          '</select>';

        out += '<div class="form-grid" style="margin-top:10px">' +
          '<label class="field"><span>伤害</span>' + dmgSelect + '</label>' +
        '</div>' +
        '<div class="action-grid" style="margin-top:10px">' +
          '<button class="btn danger" data-cb="dmg">结算伤害</button>' +
          (mode === 'maneuver' ? '<button class="btn" data-cb="ap">战技：1D3 行动点损失</button><button class="btn" data-cb="push">推回 1 个地点</button>' : '') +
          (isVeh ? '<button class="btn" data-cb="ram">载具撞击（体格 × 1D10）</button>' : '') +
        '</div>';
      }

      document.getElementById('cbOut').innerHTML = out;
      document.getElementById('cbRoll').disabled = true;
      COC.store.log('冲突：' + p.name + '（' + a.value + ' ' + a.level + '）对 ' + t.name +
        '（' + b.value + ' ' + b.level + '）' + (win ? '胜出' : '未命中') + '。');
      save();
      renderChase();

      var dmgBtn = modalRoot.querySelector('[data-cb="dmg"]');
      if (dmgBtn) dmgBtn.addEventListener('click', function () {
        var expr = val('cbDmg');
        if (!expr || expr === '0') { toast('无伤害'); return; }
        var roll = COC.dice.roll(expr);
        var res = COC.chase.applyDamage(t, roll.total);
        COC.store.log('伤害结算：' + t.name + ' 承受 ' + diceNote(roll) + ' 点伤害' +
          (res.type === 'vehicle' ? '（累计体格损失 ' + res.buildLoss + '）' : '（剩余 HP ' + res.hp + '）') + '。');
        save();
        renderChase();
        toast(t.name + ' 承受 ' + roll.total + ' 点伤害');
      });

      var apBtn = modalRoot.querySelector('[data-cb="ap"]');
      if (apBtn) apBtn.addEventListener('click', function () {
        var res = COC.dice.roll('1D3');
        COC.chase.loseAP(t, res.total);
        COC.store.log('战技：' + t.name + ' 损失 ' + res.total + ' 点行动点。');
        save();
        renderChase();
        toast(t.name + ' 损失 ' + res.total + ' 点行动点');
      });

      var pushBtn = modalRoot.querySelector('[data-cb="push"]');
      if (pushBtn) pushBtn.addEventListener('click', function () {
        t.loc = Math.max(0, t.loc - 1);
        COC.store.log('战技：' + t.name + ' 被推回地点 ' + t.loc + '。');
        save();
        renderChase();
        toast(t.name + ' 被推回 1 个地点');
      });

      var ramBtn = modalRoot.querySelector('[data-cb="ram"]');
      if (ramBtn) ramBtn.addEventListener('click', function () {
        var roll = COC.dice.roll(COC.chase.vehicleAttackDice(p));
        var res = COC.chase.applyDamage(t, roll.total);
        var cap = Math.max(0, (t.build || 0)) * 10;
        var selfAmount = Math.min(Math.floor(roll.total / 2), cap);
        var selfRes = COC.chase.applyDamage(p, selfAmount);
        COC.store.log('载具撞击：' + p.name + ' 对 ' + t.name + ' 造成 ' + diceNote(roll) + ' 点伤害' +
          (res.type === 'vehicle' ? '（体格损失 ' + res.buildLoss + '）' : '（HP ' + res.hp + '）') +
          '；自身承受 ' + selfAmount + ' 点，体格损失 ' + selfRes.buildLoss + '。');
        save();
        renderChase();
        toast('撞击结算完成');
      });
    });
  }

  function openAccident() {
    var chase = st().chase;
    var p = active();
    if (!chase || !p || p.kind !== 'vehicle') { toast('请选择载具参与者', 'bad'); return; }
    openModal({
      title: '交通事故 · ' + p.name,
      sub: '表Ⅵ（P123）· 乘客承受等量耐久伤害，并损失 1D3 行动点',
      body: '<div class="form-grid"><label class="field"><span>事故等级</span><select id="acLevel">' +
        COC.tables.accidents.map(function (a) {
          return '<option value="' + a.dice + '" data-name="' + a.name + '">' + a.name + ' · ' + a.dice + '（' + a.level + '）</option>';
        }).join('') + '</select></label></div>' +
        '<p class="hint">普通险境用轻微事故、困难用中度事故、极难用严重事故。</p>',
      foot: '<button class="btn" data-close>取消</button><button class="btn danger" id="acApply">结算事故</button>'
    });
    document.getElementById('acApply').addEventListener('click', function () {
      var sel = document.getElementById('acLevel');
      var expr = sel.value;
      var name = sel.options[sel.selectedIndex].dataset.name;
      var roll = COC.dice.roll(expr);
      var res = COC.chase.applyDamage(p, roll.total);
      var riders = chase.parts.filter(function (x) { return x.passengerOf === p.pid; });
      riders.forEach(function (r) { COC.chase.applyDamage(r, roll.total); });
      var apLoss = COC.dice.roll('1D3');
      COC.chase.loseAP(p, apLoss.total);
      COC.store.log('交通事故（' + name + '）：' + p.name + ' 承受 ' + diceNote(roll) + ' 点伤害，体格损失 ' + res.buildLoss +
        (riders.length ? '；乘客 ' + riders.map(function (r) { return r.name; }).join('、') + ' 各承受 ' + roll.total + ' 点伤害' : '') +
        '；损失 ' + apLoss.total + ' 点行动点。');
      save();
      renderChase();
      closeModal();
      toast('事故结算完成');
    });
  }

  /* ---------------- 可选规则工具 ---------------- */

  function openSudden() {
    var chase = st().chase;
    if (!chase) return;
    var isPlayer = chase.suddenNext !== 'kp';
    openModal({
      title: '突发险境',
      sub: 'P117–118 · 玩家与守秘人轮流提出',
      body: '<div class="result-banner info">下一次应由 <b>' + (isPlayer ? '玩家' : '守秘人') + '</b> 提出。</div>' +
        '<p class="hint">玩家可要求一次团体幸运检定：成功则自行指定突发险境发生的地点与时机；失败则由守秘人放置一处普通难度的突发险境。</p>',
      foot: '<button class="btn" data-close>关闭</button>' +
        (isPlayer
          ? '<button class="btn primary" id="sdPlayer">玩家要求团体幸运检定</button>'
          : '<button class="btn primary" id="sdKeeper">守秘人放置突发险境</button>')
    });
    if (isPlayer) {
      document.getElementById('sdPlayer').addEventListener('click', function () {
        var lucks = chase.parts.map(function (x) { return x.luck || 50; });
        var avg = lucks.length ? Math.round(lucks.reduce(function (a, b) { return a + b; }, 0) / lucks.length) : 50;
        var r = COC.dice.check(avg, {});
        var ok = r.rank >= 2;
        COC.store.log('突发险境：团体幸运检定 ' + r.value + ' ' + r.level + '，' + (ok ? '玩家指定突发险境位置。' : '守秘人放置一处突发险境。'));
        chase.suddenNext = 'kp';
        save();
        renderChase();
        openModal({
          title: '团体幸运检定',
          sub: '团体幸运值按参与者平均幸运 ' + avg + '%',
          body: checkHTML(r, '团体幸运') + '<div class="result-banner ' + (ok ? 'ok' : 'bad') + '">' +
            (ok ? '成功：玩家可以指定突发险境发生的地点与时机。' : '失败：由守秘人放置一处普通难度的突发险境。') + '</div>',
          foot: '<button class="btn primary" data-close>知道了</button>'
        });
      });
    } else {
      document.getElementById('sdKeeper').addEventListener('click', function () {
        chase.suddenNext = 'players';
        COC.store.log('突发险境：守秘人放置一处普通难度的突发险境，下一次由玩家提出。');
        save();
        renderChase();
        closeModal();
        toast('已记录：下一次由玩家提出');
      });
    }
  }

  function openActorInfo(pid) {
    var chase = st().chase;
    if (!chase) return;
    var p = COC.chase.part(chase, pid);
    if (!p) return;
    var isVeh = p.kind === 'vehicle';
    var veh = isVeh ? COC.chase.vehicleState(p) : null;
    var skillChips = ['climb', 'dodge', 'swim', 'jump', 'lock', 'drive', 'stealth', 'track', 'spot', 'navigate', 'fight', 'shoot']
      .map(function (k) {
        var v = p.skills[k] || 0;
        return '<span class="chip">' + COC.store.SKILLS[k] + ' ' + v + '% <span class="muted">难 ' +
          Math.floor(v / 2) + ' / 极 ' + Math.floor(v / 5) + '</span></span>';
      }).join('');

    openModal({
      title: p.name,
      sub: COC.store.KIND_LABEL[p.kind] + ' · ' + (p.role === 'escapee' ? '逃离者' : '追逐者') +
        (p.passengerOf ? ' · 乘客' : '') + ' · 地点 ' + p.loc + '（' + chase.locations[p.loc].name + '）',
      wide: true,
      body:
        '<div class="summary">' +
          kvRow('敏捷 DEX', p.dex) +
          kvRow('体质 CON', p.con) +
          kvRow('力量 STR', p.str) +
          (isVeh ? '' : kvRow('体型 SIZ', p.siz != null ? p.siz : '—')) +
          (isVeh ? '' : kvRow('年龄', p.age ? p.age + ' 岁' : '—')) +
          kvRow('体格 Build', p.build) +
          kvRow('MOV', p.mov + '（衍生基准 ' + p.movBase + '）') +
          kvRow('行动点', COC.chase.remaining(p) + ' / ' + p.apBase + (p.debt ? '（欠账 ' + p.debt + '）' : '')) +
          kvRow(isVeh ? '载具体格' : '生命值', isVeh ? (veh.buildNow + ' / ' + p.build) : (p.hp + ' / ' + p.hpMax)) +
          kvRow('护甲', p.armor) +
        '</div>' +
        '<div class="chips">' + skillChips + '</div>' +
        '<p class="hint">进行中的追逐使用独立快照，这里受到的伤害不会写回角色卡。</p>',
      foot: '<button class="btn" data-close>关闭</button>' +
        (isVeh ? '<button class="btn" id="aiDriver">驾驶员重伤检定</button>' : '') +
        '<button class="btn danger" id="aiDamage">造成伤害</button>' +
        '<button class="btn" id="aiHeal">治疗 / 修复</button>'
    });

    if (isVeh) {
      document.getElementById('aiDriver').addEventListener('click', function () {
        var skillKey = COC.chase.vehicleSkill(p);
        var thr = Math.floor((p.skills[skillKey] || 0) / 2);
        openModal({
          title: '驾驶员重伤 · ' + p.name,
          sub: 'P120 · 重伤但保持清醒时，须立即进行一次困难难度险境检定',
          body: rollFields('drv', thr, 0, 0) + '<div id="drvOut"></div>',
          foot: '<button class="btn" data-close>关闭</button><button class="btn primary" id="drvRoll">掷骰</button>'
        });
        document.getElementById('drvRoll').addEventListener('click', function () {
          var r = readRoll('drv');
          var ok = r.rank >= 2;
          document.getElementById('drvOut').innerHTML = checkHTML(r, COC.store.SKILLS[skillKey] + '（困难）') +
            '<div class="result-banner ' + (ok ? 'ok' : 'bad') + '">' +
            (ok ? '成功保持对载具的控制。' : '未能保持控制，请按交通事故结算。') + '</div>';
          COC.store.log('驾驶员重伤检定：' + p.name + ' ' + r.value + ' ' + r.level + ' → ' + (ok ? '保持控制' : '失去控制'));
          save();
        });
      });
    }

    document.getElementById('aiDamage').addEventListener('click', function () {
      var input = window.prompt('对 ' + p.name + ' 造成的伤害点数', '5');
      if (input === null) return;
      var amount = Math.max(0, parseInt(input, 10) || 0);
      if (!amount) return;
      var out = COC.chase.applyDamage(p, amount);
      COC.store.log('手动伤害：' + p.name + ' 承受 ' + amount + ' 点' +
        (out.type === 'vehicle' ? '（体格损失 ' + out.buildLoss + '）' : '（剩余 HP ' + out.hp + '）') + '。');
      save();
      renderChase();
      closeModal();
      toast('已结算 ' + amount + ' 点伤害');
    });

    document.getElementById('aiHeal').addEventListener('click', function () {
      var input = window.prompt('对 ' + p.name + ' 恢复 / 修复的点数', '5');
      if (input === null) return;
      var amount = Math.max(0, parseInt(input, 10) || 0);
      if (!amount) return;
      if (isVeh) {
        p.dmgPool = Math.max(0, p.dmgPool - amount);
      } else {
        p.hp = Math.min(p.hpMax, p.hp + amount);
      }
      COC.store.log('手动恢复：' + p.name + ' 恢复 ' + amount + ' 点' + (isVeh ? '伤害池。' : '生命值。'));
      save();
      renderChase();
      closeModal();
      toast('已恢复');
    });
  }

  function openRandomPeril() {
    var chase = st().chase;
    if (!chase) return;
    var totalEdges = Math.max(0, chase.locations.length - 1);
    var usedEdges = {};
    chase.hazards.forEach(function (h) { usedEdges[h.edge] = true; });
    var freeEdges = [];
    for (var i = 1; i <= totalEdges; i++) if (!usedEdges[i]) freeEdges.push(i);
    if (!freeEdges.length) { toast('地点轨上没有空余区段，先添加地点', 'bad'); return; }

    var hasVehicle = chase.parts.some(function (p) { return p.kind === 'vehicle'; });
    var maxCount = Math.min(8, freeEdges.length);
    var generated = null;

    openModal({
      title: '随机险境与障碍',
      sub: 'P117 · 按数量随机生成，散布到地点轨的空余区段',
      wide: true,
      body:
        '<div class="form-grid">' +
          '<label class="field"><span>数量（1–' + maxCount + '）</span>' +
            '<input id="rpCount" type="number" min="1" max="' + maxCount + '" value="' + Math.min(2, maxCount) + '"></label>' +
          '<label class="field"><span>类型</span><select id="rpKind">' +
            '<option value="peril">险境</option>' +
            '<option value="mixed">险境与障碍混合</option>' +
            '<option value="obstacle">障碍</option>' +
          '</select></label>' +
          '<label class="field"><span>环境修正</span><select id="rpMod">' +
            '<option value="0">常规</option>' +
            '<option value="-1">极度危险（+1 惩罚骰）</option>' +
            '<option value="1">十分安全（+1 奖励骰）</option>' +
          '</select></label>' +
          '<label class="field"><span>可用区段</span><input type="text" value="' + freeEdges.length + ' 段" readonly></label>' +
        '</div>' +
        '<p class="hint">素材取' + (hasVehicle ? '汽车追逐' : '步行追逐') + '范例；每个区段掷 1D100 决定难度（01–59 本无障碍，会重掷以保证数量）。地点随机且互不重复。</p>' +
        '<div id="rpOut"></div>',
      foot: '<button class="btn" data-close>关闭</button><button class="btn primary" id="rpRoll">掷骰生成</button>'
    });

    function shuffled(list) {
      var arr = list.slice();
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    }

    function shortName(full) {
      var mapped = COC.tables.shortNames[full];
      if (mapped) return mapped;
      var s = String(full).replace(/^(一处|一条|一段|一堵|一扇|在)/, '');
      s = s.split(/[、，,]|或/)[0];
      return s.length > 6 ? s.slice(0, 6) : s;
    }

    function pickDifficulty(mod) {
      var opts = { bonus: mod > 0 ? 1 : 0, penalty: mod < 0 ? 1 : 0 };
      for (var n = 0; n < 40; n++) {
        var r = COC.dice.check(100, opts);
        if (r.value >= 60) {
          return { value: r.value, difficulty: r.value >= 96 ? 'extreme' : (r.value >= 85 ? 'hard' : 'regular') };
        }
      }
      return { value: 60, difficulty: 'regular' };
    }

    function renderPreview() {
      var rows = generated.map(function (g) {
        var meta = '地点 ' + (g.edge - 1) + ' → ' + g.edge + ' · ' +
          (g.kind === 'obstacle' ? '障碍 · 耐久 ' + g.dur : '险境') + ' · ' +
          COC.chase.difficultyLabel(g.difficulty) + '（1D100 = ' + g.roll + '）';
        return setupRowHTML(g.name, meta,
          '<span class="badge ' + (g.kind === 'obstacle' ? 'vehicle' : '') + '">' + (g.kind === 'obstacle' ? '障碍' : '险境') + '</span>');
      }).join('');
      document.getElementById('rpOut').innerHTML =
        '<div class="setup-list" style="margin-top:10px">' + rows + '</div>' +
        '<button class="btn primary wide" id="rpApply" style="margin-top:10px">放置这 ' + generated.length + ' 处</button>' +
        '<p class="hint">不满意可再次点「掷骰生成」重掷；已放置的险境不会重复占用同一区段。</p>';
      document.getElementById('rpApply').addEventListener('click', function () {
        generated.forEach(function (g) {
          chase.hazards.push({
            hid: COC.store.uid(),
            edge: g.edge,
            kind: g.kind,
            name: g.name,
            short: g.short,
            difficulty: g.difficulty,
            skills: g.kind === 'obstacle' ? ['climb', 'str'] : ['dodge', 'dex', 'str'],
            durability: g.kind === 'obstacle' ? g.dur : null,
            maxDur: g.kind === 'obstacle' ? g.dur : null,
            cleared: false
          });
        });
        COC.store.log('随机生成 ' + generated.length + ' 处：' +
          generated.map(function (g) {
            return '地点 ' + (g.edge - 1) + '→' + g.edge + ' ' + g.name + '（' +
              COC.chase.difficultyLabel(g.difficulty) + '）';
          }).join('、') + '。');
        save();
        renderChase();
        closeModal();
        toast('已放置 ' + generated.length + ' 处');
      });
    }

    document.getElementById('rpRoll').addEventListener('click', function () {
      var count = Math.max(1, Math.min(maxCount, parseInt(val('rpCount'), 10) || 1));
      document.getElementById('rpCount').value = count;
      var mod = parseInt(val('rpMod'), 10) || 0;
      var kindMode = val('rpKind');
      var edges = shuffled(freeEdges).slice(0, count).sort(function (a, b) { return a - b; });
      var perils = shuffled(hasVehicle ? COC.tables.perilExamples.car : COC.tables.perilExamples.walk);
      var obstacles = shuffled(COC.tables.obstaclePresets);
      var obstacleQuota = kindMode === 'obstacle' ? edges.length
        : (kindMode === 'mixed' ? Math.floor(edges.length / 3) : 0);

      generated = edges.map(function (edge, idx) {
        var isObstacle = idx < obstacleQuota;
        var d = pickDifficulty(mod);
        if (isObstacle) {
          var o = obstacles.shift() || { name: '障碍', dur: 10 };
          return {
            edge: edge, kind: 'obstacle', name: o.name, short: shortName(o.name),
            dur: o.dur, difficulty: d.difficulty, roll: d.value
          };
        }
        var pName = perils.shift() || ('险境 ' + (idx + 1));
        return {
          edge: edge, kind: 'peril',
          name: pName, short: shortName(pName),
          dur: null, difficulty: d.difficulty, roll: d.value
        };
      });
      renderPreview();
    });
  }

  function openHide() {
    var chase = st().chase;
    var p = active();
    if (!chase || !p) return;
    var pursuers = chase.parts.filter(function (x) { return x.role !== p.role; });
    var nearest = pursuers.sort(function (a, b) { return b.loc - a.loc; })[0];
    openModal({
      title: '躲藏 / 追踪',
      sub: 'P119 · 躲藏为潜行对抗侦查；追逐者用追踪检定继续追逐',
      body:
        '<div class="form-grid">' +
          '<label class="field"><span>躲藏者潜行</span><input id="hdStealth" type="number" min="0" max="200" value="' + (p.skills.stealth || 0) + '"></label>' +
          '<label class="field"><span>追逐者侦查</span><input id="hdSpot" type="number" min="0" max="200" value="' + (nearest ? nearest.skills.spot || 0 : 0) + '"></label>' +
          '<label class="field"><span>追逐者追踪</span><input id="hdTrack" type="number" min="0" max="200" value="' + (nearest ? nearest.skills.track || 0 : 0) + '"></label>' +
        '</div>' +
        '<div id="hdOut"></div>',
      foot: '<button class="btn" data-close>关闭</button>' +
        '<button class="btn" id="hdHide">躲藏对抗（潜行 vs 侦查）</button>' +
        '<button class="btn" id="hdTrackRoll">追逐者追踪检定</button>'
    });
    document.getElementById('hdHide').addEventListener('click', function () {
      var a = COC.dice.check(parseInt(val('hdStealth'), 10) || 0, {});
      var b = COC.dice.check(parseInt(val('hdSpot'), 10) || 0, {});
      var opp = COC.dice.opposed(a, b);
      var ok = opp.winner === 'a';
      document.getElementById('hdOut').innerHTML =
        '<div class="form-grid"><div>' + checkHTML(a, '潜行') + '</div><div>' + checkHTML(b, '侦查') + '</div></div>' +
        '<div class="result-banner ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '躲藏成功：追逐者失去了猎物的踪迹。' : '躲藏失败：追逐者发现了你。') + '</div>' +
        (ok ? '<button class="btn primary wide" id="hdEnd" style="margin-top:10px">结束追逐</button>' : '');
      COC.store.log('躲藏：潜行 ' + a.value + ' ' + a.level + ' vs 侦查 ' + b.value + ' ' + b.level + ' → ' + (ok ? '成功逃脱' : '被发现'));
      save();
      if (ok) {
        document.getElementById('hdEnd').addEventListener('click', function () {
          endChase('躲藏成功，追逐结束。');
          closeModal();
        });
      }
    });
    document.getElementById('hdTrackRoll').addEventListener('click', function () {
      var r = COC.dice.check(parseInt(val('hdTrack'), 10) || 0, {});
      var ok = r.rank >= 2;
      document.getElementById('hdOut').innerHTML = checkHTML(r, '追踪') +
        '<div class="result-banner ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '追踪成功：追逐继续。' : '追踪失败：被甩开了。') + '</div>';
      COC.store.log('追踪检定：' + r.value + ' ' + r.level + ' → ' + (ok ? '追踪继续' : '跟丢目标'));
      save();
      if (!ok) {
        endChase('追踪失败，追逐结束。');
      }
    });
  }

  function openCraftPeril() {
    var chase = st().chase;
    var p = active();
    if (!chase || !p) return;
    openModal({
      title: '人为制造的险境',
      sub: 'P121 · 通常消耗 1 行动点 / 一次技能检定，或二者皆需',
      body: '<div class="setup-list">' +
        craftRow('lock', '停下来用门闩或钥匙锁住门', '花费 1 行动点，无需检定') +
        craftRow('pick', '用锁匠技能锁住一扇门', '花费一整轮 + 成功检定') +
        craftRow('wardrobe', '把沉重衣柜推去挡住门', '力量检定 + 1 行动点') +
        craftRow('stall', '掀翻水果摊拖延追逐者', '花费 1 行动点') +
        craftRow('gun', '鸣枪制造人群恐慌', '幸运检定；失败会引来更多麻烦') +
        craftRow('shout', '对路人大喊「抓住他，他是贼！」', '话术或恐吓检定') +
      '</div>',
      foot: '<button class="btn" data-close>关闭</button>'
    });
    modalRoot.querySelectorAll('[data-craft]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.dataset.craft;
        var needAP = key !== 'pick';
        if (needAP) {
          if (COC.chase.remaining(p) < 1) { toast('行动点不足', 'bad'); return; }
          COC.chase.spend(p, 1);
        }
        var text = {
          lock: '用门闩 / 钥匙锁门（1 行动点）',
          pick: '锁匠锁门（整轮）',
          wardrobe: '推衣柜挡门（力量检定 + 1 行动点）',
          stall: '掀翻水果摊（1 行动点）',
          gun: '鸣枪制造恐慌（幸运检定）',
          shout: '呼喊路人协助（话术 / 恐吓）'
        }[key];
        COC.store.log('人为险境：' + p.name + ' ' + text + '。');
        save();
        renderChase();
        closeModal();
        toast('已记录人为险境');
      });
    });
  }

  function craftRow(key, title, note) {
    return setupRowHTML(title, esc(note), '<button class="btn tiny" data-craft="' + key + '">记录</button>');
  }

  function openMoveMode() {
    var chase = st().chase;
    var p = active();
    if (!chase || !p) return;
    var startMode = p.kind === 'vehicle' ? 'vehicle' : 'walk';

    openModal({
      title: '更换移动方式 · ' + p.name,
      sub: 'P120–121 · 自力换自力无需重投；步行与驾车互换需重新进行速度检定',
      body:
        '<div class="form-grid">' +
          '<label class="field"><span>新的移动方式</span><select id="mmMode">' +
            '<option value="walk">步行（或其他自力方式）</option>' +
            '<option value="swim">游泳</option>' +
            '<option value="fly">飞行</option>' +
            '<option value="vehicle">载具</option>' +
          '</select></label>' +
          '<label class="field"><span>新的 MOV</span><input id="mmMov" type="number" min="0" max="40" value="' + p.mov + '"></label>' +
        '</div>' +
        '<p class="hint" id="mmHint"></p>' +
        '<p class="hint">资料中未列出游泳 / 飞行速度时，取通常 MOV 的一半；行动点将按新的全场最低 MOV 重新计算。</p>',
      foot: '<button class="btn" data-close>取消</button><button class="btn primary" id="mmApply">应用</button>'
    });

    function update() {
      var mode = val('mmMode');
      var suggested = (mode === 'swim' || mode === 'fly')
        ? Math.max(1, Math.round(p.movBase / 2))
        : p.movBase;
      if (mode === startMode) suggested = p.mov;
      document.getElementById('mmMov').value = suggested;
      document.getElementById('mmHint').textContent =
        (startMode === mode) ? '与当前方式相同，仅调整 MOV。'
        : ((startMode === 'vehicle') !== (mode === 'vehicle')
          ? '在步行与驾车之间切换：应使用体质（步行）或汽车驾驶（载具）重新进行速度检定。'
          : '自力行进方式之间切换：无需重新检定。');
    }
    document.getElementById('mmMode').addEventListener('change', update);
    update();

    document.getElementById('mmApply').addEventListener('click', function () {
      var mode = val('mmMode');
      var mov = parseInt(val('mmMov'), 10);
      if (isNaN(mov) || mov < 0) { toast('MOV 无效', 'bad'); return; }
      p.mov = mov;
      chase.minMov = COC.chase.recalcAP(chase.parts);
      chase.parts.forEach(function (x) { x.apUsed = Math.min(x.apUsed, x.apBase); });
      var label = { walk: '步行', swim: '游泳', fly: '飞行', vehicle: '载具' }[mode];
      COC.store.log('更换移动方式：' + p.name + ' 改为' + label + '，MOV ' + mov + '，行动点重新计算。');
      save();
      renderChase();
      closeModal();
      toast('已改为' + label + '，MOV ' + mov);
    });
  }

  function openLocationEditor(i) {
    var chase = st().chase;
    if (!chase) return;
    var loc = chase.locations[i];
    var occupied = chase.parts.some(function (p) { return p.loc === i; });
    var hasHazard = chase.hazards.some(function (h) { return h.edge === i || h.edge === i + 1; });
    var isLast = i === chase.locations.length - 1;
    var canDelete = isLast && !occupied && !hasHazard && i > 0;

    openModal({
      title: '地点 ' + i + ' · ' + loc.name,
      sub: '地点是叙事单位，可重命名；仅末尾的空地点可以删除',
      body:
        '<label class="field"><span>地点名称</span><input id="locName" type="text" value="' + esc(loc.name) + '"></label>' +
        '<p class="hint">' + (canDelete ? '删除后将缩短地点轨。' :
          (occupied ? '该地点上有参与者，无法删除。' :
            (hasHazard ? '该地点关联险境或障碍，无法删除。' : '只有地点轨末端的地点可以删除。'))) + '</p>',
      foot: '<button class="btn" data-close>取消</button>' +
        '<button class="btn danger" id="locDel"' + (canDelete ? '' : ' disabled') + '>删除地点</button>' +
        '<button class="btn primary" id="locSave">保存名称</button>'
    });

    document.getElementById('locSave').addEventListener('click', function () {
      var name = val('locName').trim();
      if (!name) { toast('地点名称不能为空', 'bad'); return; }
      loc.name = name;
      save();
      renderChase();
      closeModal();
    });

    if (canDelete) {
      document.getElementById('locDel').addEventListener('click', function () {
        chase.locations.pop();
        COC.store.log('移除地点轨末端的地点「' + loc.name + '」。');
        save();
        renderChase();
        closeModal();
      });
    }
  }

  function openSplit() {
    var chase = st().chase;
    if (!chase) return;
    openModal({
      title: '分头行动',
      sub: 'P121 · 不同路线应分别记录为新的追逐',
      body: '<div class="result-banner info">若参与者选择不同路线，应为每一组建立一个新追逐，独立记录地点、行动点与险境。</div>' +
        '<p class="hint">可以使用「结束追逐」保留本场记录，再为另一组重新建立追逐。</p>',
      foot: '<button class="btn" data-close>取消</button><button class="btn primary" id="spLog">记录分头行动</button>'
    });
    document.getElementById('spLog').addEventListener('click', function () {
      COC.store.log('分头行动：参与者选择了不同路线，需要为每一组分别建立新的追逐。');
      save();
      closeModal();
      toast('已记录，请为另一组新建追逐');
    });
  }

  /* ---------------- 回合与整理 ---------------- */

  function endChase(reason) {
    var chase = st().chase;
    if (!chase || chase.ended) return;
    chase.ended = true;
    COC.store.log('追逐结束：' + (reason || '守秘人宣布结束'));
    save();
    renderAll();
  }

  function openTie() {
    var chase = st().chase;
    if (!chase || !chase.ties.length) { toast('当前没有同敏捷的参与者'); return; }
    var pair = chase.ties[0];
    var a = COC.chase.part(chase, pair[0]);
    var b = COC.chase.part(chase, pair[1]);
    openModal({
      title: '敏捷对抗检定',
      sub: '同敏捷时用敏捷对抗决定先后（P113）',
      body: '<div class="summary">' + kvRow(a.name + ' 敏捷', a.dex) + kvRow(b.name + ' 敏捷', b.dex) + '</div><div id="tieOut"></div>',
      foot: '<button class="btn" data-close>稍后</button><button class="btn primary" id="tieRoll">掷骰</button>'
    });
    document.getElementById('tieRoll').addEventListener('click', function () {
      var ra = COC.dice.check(a.dex, {});
      var rb = COC.dice.check(b.dex, {});
      var opp = COC.dice.opposed(ra, rb);
      var winPid = opp.winner === 'b' ? b.pid : a.pid;
      var losePid = opp.winner === 'b' ? a.pid : b.pid;
      COC.chase.shuffleOrderForTie(chase, winPid, losePid);
      chase.ties = chase.ties.filter(function (t) { return t !== pair; });
      COC.store.log('敏捷对抗：' + a.name + '（' + ra.value + ' ' + ra.level + '） vs ' + b.name + '（' + rb.value + ' ' + rb.level + '）→ ' +
        (COC.chase.part(chase, winPid).name) + ' 先行。');
      save();
      renderAll();
      document.getElementById('tieOut').innerHTML =
        '<div class="form-grid"><div>' + checkHTML(ra, a.name) + '</div><div>' + checkHTML(rb, b.name) + '</div></div>' +
        '<div class="result-banner info">' + COC.chase.part(chase, winPid).name + ' 先行动。</div>';
      document.getElementById('tieRoll').disabled = true;
    });
  }

  /* ---------------- 其他视图 ---------------- */

  function renderRefs() {
    var view = document.getElementById('view-refs');
    var vehicleTables = COC.tables.vehicleCategories.map(function (cat) {
      return '<div class="panel"><table class="table"><caption>' + cat.name + '</caption>' +
        '<thead><tr><th>载具</th><th>MOV</th><th>体格</th><th>乘客护甲</th><th>乘客</th></tr></thead><tbody>' +
        cat.items.map(function (i) {
          return '<tr data-search="' + esc(i.name) + ' 载具"><td>' + esc(i.name) + '</td><td class="num">' + i.mov +
            '</td><td class="num">' + i.build + '</td><td class="num">' + i.armor + '</td><td class="num">' + i.cap + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).join('');

    var accidents = '<div class="panel"><table class="table"><caption>表Ⅵ：交通事故（P123）</caption>' +
      '<thead><tr><th>事故</th><th>伤害</th><th>范例</th></tr></thead><tbody>' +
      COC.tables.accidents.map(function (a) {
        return '<tr data-search="' + esc(a.name + ' 事故 ' + a.dice) + '"><td>' + a.name + '</td><td class="num">' + a.dice +
          '</td><td class="muted">' + esc(a.example) + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    var damages = '<div class="panel"><table class="table"><caption>表Ⅲ：其他形式的伤害（P110）</caption>' +
      '<thead><tr><th>程度</th><th>伤害</th><th>说明</th></tr></thead><tbody>' +
      COC.tables.damageLevels.map(function (d) {
        return '<tr data-search="' + esc(d.name + ' 伤害') + '"><td>' + d.name + '</td><td class="num">' + (d.dice || '无') +
          '</td><td class="muted">' + esc(d.note) + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    var obstacles = '<div class="panel"><table class="table"><caption>障碍耐久参考（P116）</caption>' +
      '<thead><tr><th>障碍</th><th>耐久</th><th></th></tr></thead><tbody>' +
      COC.tables.obstaclePresets.map(function (o) {
        return '<tr data-search="' + esc(o.name + ' 障碍 耐久') + '"><td>' + esc(o.name) + '</td><td class="num">' + o.dur +
          '</td><td><button class="btn tiny" data-act="use-obstacle" data-name="' + esc(o.name) + '" data-dur="' + o.dur + '">用作新障碍</button></td></tr>';
      }).join('') + '</tbody></table></div>';

    var random = '<div class="panel"><table class="table"><caption>随机险境与障碍（P117）</caption>' +
      '<thead><tr><th>1D100</th><th>结果</th></tr></thead><tbody>' +
      COC.tables.randomPerilRows.map(function (r) {
        return '<tr data-search="' + esc(r.range + ' ' + r.result) + '"><td class="num">' + r.range + '</td><td>' + r.result + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="hint" style="margin-top:8px">环境极度危险时加 1 惩罚骰；明显安全时加 1 奖励骰。</p></div>';

    var examples = '<div class="panel"><div class="panel-head"><h3>险境与障碍范例</h3><span class="sub">P115</span></div>' +
      '<div class="chips">' + COC.tables.perilExamples.walk.concat(COC.tables.perilExamples.obstacleWalk).map(function (x) {
        return '<span class="chip" data-search="' + esc(x) + '">' + esc(x) + '</span>';
      }).join('') + '</div>' +
      '<div class="chips" style="margin-top:8px">' + COC.tables.perilExamples.car.concat(COC.tables.perilExamples.obstacleCar).map(function (x) {
        return '<span class="chip" data-search="' + esc(x) + '">' + esc(x) + '</span>';
      }).join('') + '</div></div>';

    var rules = '<div class="panel"><div class="panel-head"><h3>第七章规则要点</h3><span class="sub">P111–127</span></div>' +
      '<div class="rule-list">' + COC.tables.rules.map(function (r) {
        return '<div class="rule-item" data-search="' + esc(r.pg + ' ' + r.title + ' ' + r.text) + '">' +
          '<span class="pg">' + r.pg + '</span><span><b>' + r.title + '</b> · ' + r.text + '</span></div>';
      }).join('') + '</div></div>';

    view.innerHTML =
      '<div class="view-head"><div><h2>规则速查</h2><p>第七章全部表格与要点，数值与页码均对照规则书。搜索可快速定位，障碍与载具数据可直接套用。</p></div></div>' +
      '<div class="ref-tools"><input type="search" id="refSearch" placeholder="搜索：围栏 / 交通事故 / 战技 / 猛踩油门 …"></div>' +
      '<div class="ref-grid">' + rules + damages + accidents + obstacles + random + examples + '</div>' +
      '<div class="ref-grid" style="margin-top:16px">' + vehicleTables + '</div>';

    var search = document.getElementById('refSearch');
    search.value = refsQuery;
    function applyFilter() {
      var q = refsQuery.trim().toLowerCase();
      view.querySelectorAll('[data-search]').forEach(function (node) {
        var hay = (node.dataset.search || '').toLowerCase();
        node.classList.toggle('is-hidden', !!q && hay.indexOf(q) < 0);
      });
    }
    search.addEventListener('input', function () {
      refsQuery = search.value;
      applyFilter();
    });
    applyFilter();
  }

  function renderLog() {
    var view = document.getElementById('view-log');
    var entries = st().log.slice().reverse();
    view.innerHTML =
      '<div class="view-head"><div><h2>日志</h2><p>记录速度检定、移动、险境结算、冲突与所有掷骰结果，便于复盘。</p></div>' +
        '<div class="view-actions"><button class="btn ghost danger" data-act="clear-log">清空日志</button></div></div>' +
      (entries.length
        ? '<div class="panel"><div class="log-list">' + entries.map(function (e) {
            return '<div class="log-row"><span class="time">' + timeText(e.at) + '</span>' +
              '<span class="rnd">' + (e.round ? '第 ' + e.round + ' 轮' : '—') + '</span>' +
              '<span class="txt">' + esc(e.text) + '</span></div>';
          }).join('') + '</div></div>'
        : '<div class="empty">暂无日志。建立追逐并开始行动后，这里会记录每一步结算。</div>');
  }

  /* ---------------- 事件分发 ---------------- */

  document.addEventListener('click', function (e) {
    var close = e.target.closest('[data-close]');
    if (close) { userCloseModal(); return; }
    if (e.target === modalRoot) { userCloseModal(); return; }
    if (e.target.closest('.modal')) return;

    var el = e.target.closest('[data-act]');
    if (!el) return;
    var chase = st().chase;
    var act = el.dataset.act;

    switch (act) {
      case 'new-char': openEditor(null, 'pc'); break;
      case 'new-vehicle': openEditor(null, 'vehicle'); break;
      case 'edit-char': {
        var c = COC.store.getChar(el.dataset.id);
        if (c) openEditor(c, c.kind);
        break;
      }
      case 'dup-char': {
        var src = COC.store.getChar(el.dataset.id);
        if (src) {
          var copy = JSON.parse(JSON.stringify(src));
          copy.id = COC.store.uid();
          copy.name = src.name + '（副本）';
          COC.store.upsert(copy);
          renderAll();
          toast('已复制角色卡');
        }
        break;
      }
      case 'del-char': {
        var target = COC.store.getChar(el.dataset.id);
        if (!target) break;
        var inUse = st().setup && st().setup.entries.some(function (en) { return en.charId === target.id; });
        if (inUse) { toast('该角色已加入追逐名单，请先移除后再删除', 'bad'); break; }
        if (!window.confirm('删除角色卡「' + target.name + '」？此操作仅影响卡库，进行中的追逐使用独立快照。')) break;
        COC.store.removeChar(target.id);
        renderAll();
        toast('已删除');
        break;
      }
      case 'to-chase': {
        var ch = COC.store.getChar(el.dataset.id);
        if (!ch) break;
        openModal({
          title: '加入追逐 · ' + ch.name,
          sub: '选择其在追逐中的身份',
          body: '<div class="result-banner info">MOV ' + baseMov(ch) + ' · ' + COC.store.KIND_LABEL[ch.kind] + '</div>',
          foot: '<button class="btn" data-close>取消</button>' +
            '<button class="btn" id="jcChaser">作为追逐者</button><button class="btn primary" id="jcEsc">作为逃离者</button>'
        });
        function add(role) {
          var setup = ensureSetup();
          setup.entries.push({ charId: ch.id, role: role, mov: null, checked: false });
          save();
          closeModal();
          switchTab('chase');
          toast('已加入追逐名单');
        }
        document.getElementById('jcChaser').addEventListener('click', function () { add('chaser'); });
        document.getElementById('jcEsc').addEventListener('click', function () { add('escapee'); });
        break;
      }
      case 'add-part': openPicker('setup'); break;
      case 'join-chase': openPicker('join'); break;
      case 'role': {
        var setupRole = ensureSetup();
        var idx = parseInt(el.dataset.i, 10);
        if (setupRole.entries[idx]) {
          setupRole.entries[idx].role = el.dataset.role;
          save();
          renderChase();
        }
        break;
      }
      case 'part-speed': openSpeedCheck(parseInt(el.dataset.i, 10)); break;
      case 'part-remove': {
        var s = ensureSetup();
        s.entries.splice(parseInt(el.dataset.i, 10), 1);
        save();
        renderChase();
        break;
      }
      case 'reset-setup':
        if (st().setup && st().setup.entries.length && !window.confirm('清空当前追逐名单？')) break;
        st().setup = { name: '无名追逐', gap: 2, entries: [] };
        save();
        renderChase();
        break;
      case 'start-chase': startChase(); break;
      case 'next-turn': {
        if (!chase || chase.ended) break;
        chase.pendingMove = null;
        var r = COC.chase.nextTurn(chase);
        if (r.newRound) COC.store.log('第 ' + chase.round + ' 轮开始，所有参与者行动点已刷新' + (chase.parts.some(function (p) { return p.debt > 0; }) ? '（欠账已扣除）' : '') + '。');
        save();
        renderChase();
        break;
      }
      case 'select-actor':
        openActorInfo(el.dataset.pid);
        break;
      case 'rename-loc': {
        if (!chase) break;
        openLocationEditor(parseInt(el.dataset.i, 10));
        break;
      }
      case 'add-loc': {
        if (!chase) break;
        var lname = window.prompt('新地点名称', '地点 ' + (chase.locations.length + 1));
        if (lname === null) break;
        COC.chase.addLocation(chase, lname.trim() || undefined);
        save();
        renderChase();
        break;
      }
      case 'add-hazard': openHazardEditor(); break;
      case 'hazard': {
        var pActive = active();
        if (!pActive) break;
        openHazardResolve(el.dataset.hid, pActive.pid, {});
        break;
      }
      case 'resolve-hazard': openHazardChoose(); break;
      case 'move1': moveActor(1, false); break;
      case 'accelerate': openAccelerate(); break;
      case 'attack': openCombat(); break;
      case 'accident': openAccident(); break;
      case 'adjust-ap': {
        var pa = active();
        if (!pa) break;
        var input = window.prompt('设置 ' + pa.name + ' 本回合已消耗的行动点（0–' + pa.apBase + '）', String(pa.apUsed));
        if (input === null) break;
        var n = parseInt(input, 10);
        if (isNaN(n)) break;
        pa.apUsed = Math.max(0, Math.min(pa.apBase, n));
        save();
        renderChase();
        break;
      }
      case 'end-chase':
        if (window.confirm('结束当前追逐？记录将保留在日志中。')) endChase('守秘人宣布结束');
        break;
      case 'archive-chase': {
        st().chase = null;
        st().setup = null;
        save();
        renderAll();
        break;
      }
      case 'tie': openTie(); break;
      case 'random-peril': openRandomPeril(); break;
      case 'toggle-tools': {
        ui.toolsOpen = !ui.toolsOpen;
        var advBox = document.getElementById('toolsAdv');
        if (advBox) advBox.hidden = !ui.toolsOpen;
        el.textContent = (ui.toolsOpen ? '▾ ' : '▸ ') + '进阶规则（5 项）';
        break;
      }
      case 'sudden': openSudden(); break;
      case 'hide': openHide(); break;
      case 'aid': {
        var padd = active();
        if (!chase || !padd) break;
        chase.aid = true;
        COC.store.log('乘客援助：' + padd.name + ' 以侦查 / 导航协助驾驶，下次加速少承受 1 个惩罚骰。');
        save();
        renderChase();
        toast('已记录乘客援助');
        break;
      }
      case 'craft-peril': openCraftPeril(); break;
      case 'change-mode': openMoveMode(); break;
      case 'split': openSplit(); break;
      case 'clear-log':
        if (window.confirm('清空全部日志？')) { COC.store.clearLog(); renderAll(); }
        break;
      case 'use-obstacle': {
        if (!chase) { toast('请先建立追逐', 'bad'); break; }
        openHazardEditor({ kind: 'obstacle', name: el.dataset.name, dur: parseInt(el.dataset.dur, 10) });
        break;
      }
      default: break;
    }
  });

  document.addEventListener('input', function (e) {
    var field = e.target.dataset.setup;
    if (field) {
      var setup = ensureSetup();
      if (field === 'gap') {
        setup.gap = Math.max(1, Math.min(5, parseInt(e.target.value, 10) || 2));
      } else {
        setup[field] = e.target.value;
      }
      save();
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target.dataset.act === 'set-carrier') {
      var chase = st().chase;
      var p = active();
      if (!chase || !p) return;
      p.passengerOf = e.target.value || null;
      p.apUsed = 0;
      chase.minMov = COC.chase.recalcAP(chase.parts);
      save();
      renderChase();
    }
  });

  /* ---------------- 启动 ---------------- */

  function init() {
    modalRoot = document.getElementById('modalRoot');
    toastEl = document.getElementById('toast');
    COC.store.load();
    bindTop();
    var hash = (location.hash || '').replace('#', '');
    if (['library', 'chase', 'refs', 'log'].indexOf(hash) >= 0) switchTab(hash);
    else renderAll();
    if (!COC.store.isStorageOK()) {
      toast('浏览器阻止了本地存储，刷新后数据可能丢失；请用「导出 JSON」备份', 'bad');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
