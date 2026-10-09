/*!
 * app-customize.js —— 音频自定义页
 *
 * 交互流程：
 *   列表（名称 / 用途 / 文字提示 / 状态）→ 点击某项 → 打开录音弹层
 *   弹层内：大字显示模仿提示 → 「试听原声」→ 按住/点击录音 → 停止
 *          → 「试听我的录音 / 重来 / 保存 / 删除」
 *   也可不走麦克风：「导入本地音频」或粘贴 URL 加载。导入与录音共用
 *   同一草稿槽（state.recordedBlob），试听/保存/删除/失效缓存逻辑零改动复用。
 *
 * 保存即按 clip.id 写入存储；写入成功后调用 VoicePlayer.invalidate(id) 失效缓存，
 * 因此返回主页面（或下次播放）会立即读到新录音——这就是"按片段 ID 一一对应、自动生效"。
 */
(function (global) {
  'use strict';

  // 录音上限按内置原声参考时长自适应（×3，钳位 1s–3s）：参考片段普遍 0.1–0.5s，
  // 固定 10s 上限会诱导录出超长无效音频。探测失败（或不支持探测）用天花板兜底。
  var MAX_RECORD_MS = 3000;  // 上限天花板，同时兼任探测失败兜底
  var MIN_RECORD_MS = 1000;  // 上限地板
  var MAX_IMPORT_BYTES = 10 * 1024 * 1024; // 导入音频大小上限 10MB（超出直接拒绝）
  // 扩展名 → MIME：部分安卓 webview 对 m4a/ogg 返回空 type，按扩展名兜底识别
  var AUDIO_MIME_BY_EXT = {
    wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac',
    ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm'
  };

  var el = {};
  var currentBank = null;  // 当前歌姬（VcBank.resolve + VoiceClips.load 成功后写入）
  var previewAudio = null; // 试听用的 Audio 实例，必须单例，否则连点会叠加播放
  var state = {
    currentId: null,
    recorder: null,
    isRecording: false,
    startedAt: 0,
    timerId: null,
    rafId: null,
    recordedBlob: null,   // 本次草稿（录音与导入共用）
    recordedMime: '',
    recordedMs: 0,
    draftName: '',        // 草稿来源名：导入为文件名，录音为空
    draftSource: null,    // 'record' | 'import' | null
    draftSeq: 0,          // 草稿序号：连续导入时丢弃过期探测结果，防竞态
    existingBlob: null,   // 已保存过的
    previewUrl: null,
    refMs: 0,               // 内置原声参考时长 ms（openSheet 时探测，失败为 0）
    limitMs: MAX_RECORD_MS, // 本片段录音上限 ms（自适应，见 limitFromRef）
    flow: false,            // 是否处于 1→32 顺序录制模式
    autoAudio: null         // 进入片段自动播放用的 Audio 实例（与试听单例分开管理）
  };

  function $(id) { return document.getElementById(id); }

  /* ---------------- 列表 ---------------- */

  function renderList(map) {
    var clips = global.VoiceClips.all();
    var html = '';
    for (var i = 0; i < clips.length; i++) {
      var c = clips[i];
      var rec = map[c.id];
      var isCustom = !!(rec && rec.blob && rec.blob.size > 0);
      var wave = isCustom && global.VcWave ? global.VcWave.get(c.id) : null;
      // 卡片三要素：序号（大字）/ 简要标识 / 录制状态；当前处理项整卡反转
      // 已录制的额外挂一条波形缩略图 + 时长（结合点4：可视化录制档案）
      html +=
        '<li class="clip-item' + (isCustom ? ' is-custom' : '') +
          (state.currentId === c.id ? ' is-current' : '') + '" data-id="' + global.VcUI.escapeHtml(c.id) + '">' +
        '<button type="button" class="clip-item__main" data-id="' + global.VcUI.escapeHtml(c.id) + '"' +
          (isCustom ? ' title="已录制于 ' + global.VcUI.formatDate(rec.updatedAt) + '"' : '') + '>' +
        '<span class="clip-item__no">' + (i + 1) + '</span>' +
        '<span class="clip-item__name">' + global.VcUI.escapeHtml(c.name) + '</span>' +
        '<span class="clip-item__tag">' + (isCustom ? '已录制' : '未录制') + '</span>' +
        (isCustom
          ? '<span class="clip-item__wave"' +
              ' data-wave-for="' + global.VcUI.escapeHtml(c.id) + '">' +
              '<canvas class="clip-item__canvas" width="120" height="22"' +
              ' data-peak-for="' + global.VcUI.escapeHtml(c.id) + '"></canvas>' +
              '<span class="clip-item__dur"' +
              ' data-dur-for="' + global.VcUI.escapeHtml(c.id) + '">' +
              (wave ? global.VcWave.fmtDuration(wave.durationMs) : '解析中…') +
              '</span>' +
            '</span>'
          : '') +
        '</button>' +
        '</li>';
    }
    el.list.innerHTML = html;

    var btns = el.list.querySelectorAll('.clip-item__main');
    for (var j = 0; j < btns.length; j++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          openSheet(btn.getAttribute('data-id'));
        });
      })(btns[j]);
    }

    // 波形：已缓存的直接绘制；未缓存的异步解码后重绘（不阻塞列表渲染）
    hydrateWaves(map);
  }

  /**
   * 波形水合：为已录制但尚无波形的片段异步解码，然后原地更新。
   * 用 canvas 逐个绘制而非 innerHTML 重绘，避免打断用户正在进行的操作。
   */
  function hydrateWaves(map) {
    if (!global.VcWave) return;
    var canvases = el.list.querySelectorAll('.clip-item__canvas');
    for (var i = 0; i < canvases.length; i++) {
      (function (cv) {
        var id = cv.getAttribute('data-peak-for');
        if (!id) return;
        var rec = map[id];
        if (!rec || !rec.blob) return;
        var cached = global.VcWave.get(id);
        if (cached) {
          global.VcWave.draw(cv, cached.peaks, '#ffffff', '#2a5f6e');
          return;
        }
        global.VcWave.extract(rec.blob, id).then(function (w) {
          if (!w) {
            var dur = el.list.querySelector('[data-dur-for="' + id.replace(/"/g, '\\"') + '"]');
            if (dur) dur.textContent = '无法解析';
            return;
          }
          // 只在卡片仍存在时更新（用户可能已切走）
          if (!document.body.contains(cv)) return;
          global.VcWave.draw(cv, w.peaks, '#ffffff', '#2a5f6e');
          var d = el.list.querySelector('[data-dur-for="' + id.replace(/"/g, '\\"') + '"]');
          if (d) d.textContent = global.VcWave.fmtDuration(w.durationMs);
        });
      })(canvases[i]);
    }
  }

  function refresh() {
    return global.VoiceStore.list().then(function (map) {
      renderList(map);
      var n = 0;
      var prefix = currentBank ? currentBank + ':' : '';
      for (var id in map) {
        if (!Object.prototype.hasOwnProperty.call(map, id)) continue;
        // 只统计当前歌姬的前缀键（id 形如 bank:index），修复跨歌姬计数错误
        if (prefix && id.indexOf(prefix) !== 0) continue;
        n++;
      }
      var total = global.VoiceClips.count();
      el.status.textContent = (currentBank ? '歌姬 ' + currentBank + ' · ' : '') +
        '已自定义 ' + n + ' / ' + total + ' 个片段' +
        (global.VoiceStore.isPersistent() ? '' : '（⚠ 当前环境无法持久化，刷新会丢失）');
      el.status.className = 'status-bar__text' + (n > 0 ? ' status-bar__text--active' : ' status-bar__text--muted');
    }).catch(function (err) {
      global.VcUI.toast('读取失败：' + (err && err.message ? err.message : ''), 'error');
    });
  }

  /* ---------------- 录音弹层 ---------------- */

  function openSheet(id) {
    var clip = global.VoiceClips.find(id);
    if (!clip) return;
    // 记录触发元素：关闭时把焦点还回去（键盘可达性）
    el.sheet.__lastTrigger = document.activeElement;
    state.currentId = id;
    state.recordedBlob = null;
    state.recordedMime = '';
    state.recordedMs = 0;
    state.draftName = '';
    state.draftSource = null;
    state.draftSeq++;
    state.existingBlob = null;
    state.isRecording = false;
    el.importInfo.textContent = '';
    el.importUrl.value = '';
    el.fileImport.value = '';

    el.sheetTitle.textContent = clip.name;
    el.sheetUsage.textContent = clip.usage;
    el.sheetHint.textContent = clip.hint;
    updateProgress(id);
    markCurrent(id);
    el.timer.textContent = '0.0"';
    setLevel(0);

    // 进入即自动播放一次：已录制播自定义录音，未录制播内置原声（resolve 自动优先自定义）
    autoPlayOnce(id);

    // 按内置原声时长自适应本次录音上限（×3 钳位）；探测完成前用天花板兜底
    state.refMs = 0;
    state.limitMs = MAX_RECORD_MS;
    probeSrcMs(clip.src).then(function (ms) {
      if (state.currentId !== id) return; // 弹层已切换/关闭：丢弃过期结果
      state.refMs = ms;
      state.limitMs = limitFromRef(ms);
      updateSheetActions();
    });

    return global.VoiceStore.get(id).then(function (rec) {
      // 异步竞态防护：用户可能在这个 Promise 挂起期间已关闭或切换了弹层。
      // 若不校验，挂起的旧请求后到会把「已关闭」的弹层重新打开 ——
      // 表现就是「悬浮窗关不掉 / 关掉又自己出现」。
      if (state.currentId !== id) return;
      state.existingBlob = (rec && rec.blob && rec.blob.size > 0) ? rec.blob : null;
      updateSheetActions();
      el.sheet.classList.add('is-show');
      stopPreview();
    }, function () {
      // 存储不可用：仍然打开弹层，只是没有已有音频可试听
      if (state.currentId !== id) return;
      state.existingBlob = null;
      updateSheetActions();
      el.sheet.classList.add('is-show');
      stopPreview();
    });
  }

  function closeSheet() {
    // 1) 停止录音（若正在录）
    if (state.isRecording && state.recorder) {
      state.recorder.cancel();
      stopTimer();
      state.isRecording = false;
    }
    // 2) 兜底清掉可能残留的定时器 / rAF
    //    （异常路径下 stopTimer 可能没跑到，留着会造成关闭后仍在跑）
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
    if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = null; }

    // 3) 停止所有音频
    stopAutoPlay();
    stopPreview();

    // 4) 隐藏弹层
    el.sheet.classList.remove('is-show');
    // 去掉 is-show 后把焦点交还触发元素，保证键盘可达
    if (el.sheet.__lastTrigger && el.sheet.__lastTrigger.focus) {
      try { el.sheet.__lastTrigger.focus(); } catch (e) { /* noop */ }
    }
    el.sheet.__lastTrigger = null;

    // 5) 复位状态（currentId 置空同时让挂起的异步回调自行作废）
    state.currentId = null;
    state.existingBlob = null;
    state.recordedBlob = null;
    state.recordedMime = '';
    state.recordedMs = 0;
    state.draftName = '';
    state.draftSource = null;
    state.startedAt = 0;
    state.refMs = 0;
    state.limitMs = MAX_RECORD_MS;
    markCurrent(null);
    updateRecordButton();

    // 6) 复位输入区（否则下次打开会看到上一次的 URL / 提示）
    el.importInfo.textContent = '';
    el.importUrl.value = '';
    el.fileImport.value = '';
    el.timer.textContent = '0.0"';
    setLevel(0);

    // 7) 手动关闭弹层即退出顺序录制，避免"流转中但弹层已关"的状态不一致
    if (state.flow) stopFlow(true);
  }

  /** 根据当前状态决定哪些按钮可用 */
  function updateSheetActions() {
    var hasNew = !!state.recordedBlob;
    var hasExisting = !!state.existingBlob;
    var canPreview = hasNew || hasExisting;

    el.btnPlayMine.disabled = !canPreview;
    el.btnSave.disabled = !hasNew;
    el.btnDelete.disabled = !hasExisting;
    el.btnRedo.disabled = false;
    // 跳过：末位片段没有"下一个"故禁用；其余可点（非流转模式下也能当"下一个"用）
    if (el.btnSkip) {
      var idx = indexOfId(state.currentId);
      el.btnSkip.disabled = idx < 0 || idx >= global.VoiceClips.count() - 1;
    }

    var limitNote = '（录音上限 ' + global.VcUI.formatSeconds(state.limitMs) +
      (state.refMs > 0 ? '，参考原声 ' + global.VcUI.formatSeconds(state.refMs) : '') + '）';
    el.hintState.textContent = (hasNew
      ? '已就绪，可试听后保存'
      : (hasExisting ? '已存在自定义音频，可重新录制或导入覆盖' : '点击录音，或使用下方导入音频')) + limitNote;
  }

  function updateRecordButton() {
    el.btnRecord.textContent = state.isRecording ? '停止录音' : '开始录音';
    el.btnRecord.classList.toggle('is-recording', state.isRecording);
  }

  /* ---------------- 录音控制 ---------------- */

  function startTimer() {
    stopTimer();
    // 快照上限：录音过程中探测回调刷新 state.limitMs 也不影响本次已开始的录音
    var limitMs = state.limitMs || MAX_RECORD_MS;
    state.startedAt = Date.now();
    state.timerId = setInterval(function () {
      var ms = Date.now() - state.startedAt;
      el.timer.textContent = global.VcUI.formatSeconds(ms);
      if (ms >= limitMs) {
        global.VcUI.toast('已达录音上限 ' + global.VcUI.formatSeconds(limitMs) + '，自动停止', 'warn');
        stopRecording();
      }
    }, 100);

    // 电平动画
    function tick() {
      if (!state.isRecording) return;
      setLevel(state.recorder ? state.recorder.getLevel() : 0);
      state.rafId = global.requestAnimationFrame(tick);
    }
    state.rafId = global.requestAnimationFrame(tick);
  }

  function stopTimer() {
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
    if (state.rafId && global.cancelAnimationFrame) { global.cancelAnimationFrame(state.rafId); state.rafId = null; }
  }

  function setLevel(v) {
    var pct = Math.max(0, Math.min(1, v || 0));
    el.levelFill.style.transform = 'scaleX(' + pct.toFixed(3) + ')';
  }

  function ensureSupported() {
    if (!global.VoiceRecorder.isSupported()) {
      global.VcUI.toast('当前浏览器/环境不支持录音功能', 'error');
      return false;
    }
    if (!global.VoiceRecorder.isSecure()) {
      global.VcUI.toast('录音需要 HTTPS 或 localhost 环境', 'error');
      return false;
    }
    return true;
  }

  function startRecording() {
    if (!ensureSupported()) return;
    stopAutoPlay(); // 自动播放的原声必须掐断，否则会和麦克风采音混在一起
    stopPreview();

    global.VoiceRecorder.requestPermission().then(function () {
      state.recorder = global.VoiceRecorder.create();
      return state.recorder.start();
    }).then(function () {
      // 录音即开启新草稿：清掉可能残留的导入草稿。放在权限通过之后，
      // 申请被拒时不会误伤用户已导入的草稿。
      clearDraft();
      state.isRecording = true;
      updateRecordButton();
      updateSheetActions();
      startTimer();
      global.VcUI.toast('开始录音，请模仿提示发声', 'info');
    }).catch(function (err) {
      state.isRecording = false;
      updateRecordButton();
      global.VcUI.toast(err && err.message ? err.message : '无法开始录音', 'error');
    });
  }

  function stopRecording() {
    if (!state.recorder) return;
    var rec = state.recorder;
    rec.stop().then(function (result) {
      stopTimer();
      state.isRecording = false;
      state.recordedBlob = result.blob;
      state.recordedMime = result.mime;
      state.recordedMs = result.durationMs;
      state.recorder = null;
      updateRecordButton();
      updateSheetActions();
      el.timer.textContent = global.VcUI.formatSeconds(result.durationMs);
      setLevel(0);
    }).catch(function (err) {
      stopTimer();
      state.isRecording = false;
      state.recorder = null;
      updateRecordButton();
      global.VcUI.toast(err && err.message ? err.message : '录音失败', 'error');
    });
  }

  function toggleRecord() {
    global.VoicePlayer.unlock();
    if (state.isRecording) stopRecording();
    else startRecording();
  }

  /** 清空当前草稿（录音/导入共用），不动已保存的 existingBlob */
  function clearDraft() {
    state.recordedBlob = null;
    state.recordedMime = '';
    state.recordedMs = 0;
    state.draftName = '';
    state.draftSource = null;
    state.draftSeq++;
    el.importInfo.textContent = '';
    el.timer.textContent = '0.0"';
    setLevel(0);
  }

  /* ---------------- 试听 ---------------- */

  function stopPreview() {
    // 先停播放再 revoke：反序会让正在播放的音频被截断报错
    if (previewAudio) {
      try { previewAudio.pause(); previewAudio.src = ''; } catch (e) { /* noop */ }
      previewAudio = null;
    }
    if (state.previewUrl) {
      global.URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = null;
    }
  }

  function playOriginal() {
    if (!state.currentId) return;
    global.VoicePlayer.unlock();
    stopAutoPlay();
    stopPreview();
    global.VoicePlayer.playOriginal(state.currentId).catch(function (err) {
      global.VcUI.toast(err && err.message ? err.message : '原声播放失败', 'error');
    });
  }

  function playMine() {
    var blob = state.recordedBlob || state.existingBlob;
    if (!blob) return;
    global.VoicePlayer.unlock();
    stopAutoPlay();
    stopPreview();
    state.previewUrl = global.URL.createObjectURL(blob);
    previewAudio = new Audio();
    previewAudio.src = state.previewUrl;
    previewAudio.onended = function () {
      // 播完再释放：边播边 revoke 会把尾巴截断
      if (state.previewUrl) {
        global.URL.revokeObjectURL(state.previewUrl);
        state.previewUrl = null;
      }
      previewAudio = null;
    };
    var p = previewAudio.play();
    if (p && p.catch) {
      p.catch(function () { global.VcUI.toast('试听被浏览器拦截，请点击后重试', 'error'); });
    }
  }

  /* ---------------- 顺序录制流转（1 → 32） ---------------- */

  function indexOfId(id) {
    var clips = global.VoiceClips.all();
    for (var i = 0; i < clips.length; i++) {
      if (clips[i].id === id) return i;
    }
    return -1;
  }

  /** 下一个片段；已是末位返回 null */
  function nextClip(curId) {
    var idx = indexOfId(curId);
    if (idx < 0) return null;
    var clips = global.VoiceClips.all();
    return (idx + 1 < clips.length) ? clips[idx + 1] : null;
  }

  /** 第一个未录制的片段；全部已录制则返回首个 */
  function firstPending(map) {
    var clips = global.VoiceClips.all();
    for (var i = 0; i < clips.length; i++) {
      var rec = map[clips[i].id];
      if (!(rec && rec.blob && rec.blob.size > 0)) return clips[i];
    }
    return clips.length ? clips[0] : null;
  }

  function updateProgress(id) {
    if (!el.sheetProgress) return;
    var idx = indexOfId(id);
    el.sheetProgress.textContent = idx < 0 ? '' : ('第 ' + (idx + 1) + ' / ' + global.VoiceClips.count() + ' 个');
  }

  /** 卡片高亮：当前处理的那张卡整卡反转 */
  function markCurrent(id) {
    if (!el.list) return;
    var items = el.list.querySelectorAll('.clip-item');
    for (var i = 0; i < items.length; i++) {
      var li = items[i];
      if (id && li.getAttribute('data-id') === id) li.classList.add('is-current');
      else li.classList.remove('is-current');
    }
  }

  /** 推进到下一个片段；已到末位则收尾 */
  function advanceFlow(curId) {
    var next = nextClip(curId);

    // 结合点5：列车卡片动效 —— 已处理的卡片向左驶离站台，下一节进站。
    // 只在有下一节时播放驶离；若已是最后一节，则由 closeSheet 收尾。
    var runNext = function () {
      if (next) {
        if (global.VcTrainCards) {
          global.VcTrainCards.announce(indexOfId(next.id), global.VoiceClips.count());
          global.VcTrainCards.arrive(next.id);
        }
        openSheet(next.id);
      } else {
        state.flow = false;
        updateFlowButtons();
        closeSheet();
        global.VcUI.toast('已处理完第 ' + global.VoiceClips.count() + ' 个片段，全部完成', 'success', 3200);
      }
    };

    if (global.VcTrainCards && curId) {
      // 等驶离动画走完再打开下一节，避免弹层与滑出动画抢视觉焦点
      global.VcTrainCards.depart(curId, runNext);
    } else {
      runNext();
    }
  }

  function startFlow() {
    state.flow = true;
    updateFlowButtons();
    global.VoiceStore.list().then(function (map) {
      if (!state.flow) return;
      var first = firstPending(map);
      if (!first) {
        global.VcUI.toast('没有可处理的片段', 'warn');
        return;
      }
      openSheet(first.id);
      global.VcUI.toast('顺序录制开始：从第 ' + (indexOfId(first.id) + 1) + ' 个起', 'info');
    }).catch(function (err) {
      global.VcUI.toast('读取失败：' + (err && err.message ? err.message : ''), 'error');
    });
  }

  /** silent = true 时不弹 toast（closeSheet 内部调用走这条） */
  function stopFlow(silent) {
    state.flow = false;
    updateFlowButtons();
    if (!silent) global.VcUI.toast('已退出顺序录制', 'info');
  }

  function skipCurrent() {
    if (!state.currentId) return;
    if (state.isRecording) {
      global.VcUI.toast('正在录音，请先停止再跳过', 'warn');
      return;
    }
    advanceFlow(state.currentId);
  }

  function updateFlowButtons() {
    if (el.btnFlowStart) el.btnFlowStart.hidden = !!state.flow;
    if (el.btnFlowStop) el.btnFlowStop.hidden = !state.flow;
  }

  /* ---------------- 进入片段自动播放 ---------------- */

  function stopAutoPlay() {
    if (state.autoAudio) {
      try { state.autoAudio.pause(); state.autoAudio.src = ''; } catch (e) { /* noop */ }
      state.autoAudio = null;
    }
  }

  /**
   * 进入片段时自动播放一次：已录制播自定义录音，未录制播内置原声。
   * 用 VoicePlayer.resolve（自动优先自定义）而非 play，是为了自己持有 Audio 实例，
   * 好在录音/试听/关闭时及时掐断，避免和麦克风采音或试听声叠加。
   */
  function autoPlayOnce(id) {
    if (!id) return;
    stopAutoPlay();
    global.VoicePlayer.unlock();
    global.VoicePlayer.resolve(id).then(function (item) {
      if (state.currentId !== id) return; // 已切走：丢弃
      var a = new Audio();
      a.src = item.url;
      a.preload = 'auto';
      state.autoAudio = a;
      a.onended = function () { if (state.autoAudio === a) state.autoAudio = null; };
      var p = a.play();
      // 被浏览器自动播放策略拦截时静默失败：用户仍可点「试听原声 / 试听我的」
      if (p && p.catch) p.catch(function () { /* noop */ });
    }).catch(function () { /* 解析失败不阻塞录制 */ });
  }

  /* ---------------- 导入音频（本地文件 / URL） ---------------- */

  function mimeFromName(name) {
    var m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return m ? (AUDIO_MIME_BY_EXT[m[1].toLowerCase()] || '') : '';
  }

  function fmtBytes(n) {
    if (!n || n < 0) return '0 KB';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function truncateName(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  /** 用 Audio 元素探测一段 src（相对路径 / data URI / URL）的时长（ms）；读不出返回 0 */
  function probeSrcMs(src) {
    return new Promise(function (resolve) {
      var a = new Audio();
      var done = false;
      function finish(ms) {
        if (done) return;
        done = true;
        try { a.src = ''; } catch (e) { /* noop */ }
        resolve(ms);
      }
      a.preload = 'metadata';
      a.onloadedmetadata = function () {
        finish(isFinite(a.duration) ? Math.round(a.duration * 1000) : 0);
      };
      a.onerror = function () { finish(0); };
      setTimeout(function () { finish(0); }, 3000); // 部分内核不发 metadata 事件，超时兜底
      a.src = src;
    });
  }

  /** 由参考时长推导录音上限：×3 并钳位到 [MIN_RECORD_MS, MAX_RECORD_MS] */
  function limitFromRef(refMs) {
    if (!refMs || refMs <= 0) return MAX_RECORD_MS;
    return Math.max(MIN_RECORD_MS, Math.min(MAX_RECORD_MS, Math.round(refMs * 3)));
  }

  /** 用 Audio 元素探测音频时长（ms）；读不出返回 0，不阻塞导入 */
  function probeDuration(blob) {
    return new Promise(function (resolve) {
      var url = global.URL.createObjectURL(blob);
      var a = new Audio();
      var done = false;
      function finish(ms) {
        if (done) return;
        done = true;
        try { a.src = ''; } catch (e) { /* noop */ }
        global.URL.revokeObjectURL(url);
        resolve(ms);
      }
      a.preload = 'metadata';
      a.onloadedmetadata = function () {
        finish(isFinite(a.duration) ? Math.round(a.duration * 1000) : 0);
      };
      a.onerror = function () { finish(0); };
      setTimeout(function () { finish(0); }, 3000); // 部分内核不发 metadata 事件，超时兜底
      a.src = url;
    });
  }

  /**
   * 采用一份导入音频为当前草稿：与录音共用 recordedBlob 槽，
   * 之后「试听我的 / 保存 / 重来」零改动直接复用。
   */
  function adoptImport(blob, mime, name) {
    if (!state.currentId || !blob) return;
    stopPreview();
    state.draftSource = 'import';
    state.draftName = name || '';
    state.recordedMime = mime || '';
    state.draftSeq++;
    var seq = state.draftSeq;
    el.importInfo.textContent = '读取中…';
    probeDuration(blob).then(function (ms) {
      // 探测期间弹层可能已关闭或换了更晚的草稿：过期结果直接丢弃
      if (!state.currentId || state.draftSource !== 'import' || state.draftSeq !== seq) return;
      state.recordedBlob = blob;
      state.recordedMs = ms;
      el.timer.textContent = global.VcUI.formatSeconds(ms);
      el.importInfo.textContent = truncateName(state.draftName, 24) +
        ' · ' + fmtBytes(blob.size) +
        (ms > 0 ? ' · ' + global.VcUI.formatSeconds(ms) : '');
      updateSheetActions();
      global.VcUI.toast('已导入，可试听对比后保存', 'success');
    });
  }

  function blockWhileRecording() {
    if (!state.isRecording) return false;
    global.VcUI.toast('正在录音，请先停止再导入', 'warn');
    return true;
  }

  function onFilePicked(ev) {
    var f = ev.target.files && ev.target.files[0];
    ev.target.value = ''; // 清空以便下次可选同一文件
    if (!f) return;
    if (blockWhileRecording()) return;
    var mime = f.type || mimeFromName(f.name);
    if (!/^audio\//.test(mime)) {
      global.VcUI.toast('请选择音频文件（wav/mp3/m4a/ogg 等）', 'error');
      return;
    }
    if (f.size > MAX_IMPORT_BYTES) {
      global.VcUI.toast('文件过大（上限 ' + fmtBytes(MAX_IMPORT_BYTES) + '）', 'error');
      return;
    }
    adoptImport(f, mime, f.name);
  }

  function importFromUrl() {
    if (blockWhileRecording()) return;
    var url = (el.importUrl.value || '').replace(/^\s+|\s+$/g, '');
    if (!url) { global.VcUI.toast('请先粘贴音频链接', 'warn'); return; }
    if (!/^https?:\/\//i.test(url)) {
      global.VcUI.toast('仅支持 http/https 链接', 'error');
      return;
    }
    if (!global.fetch) {
      global.VcUI.toast('当前环境不支持网络加载，请改用本地导入', 'error');
      return;
    }
    global.VcUI.toast('正在加载音频…', 'info');
    global.fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(function (blob) {
      var name = 'url-audio';
      try { name = decodeURIComponent(url.split('?')[0].split('/').pop() || 'url-audio') || name; } catch (e) { /* 保留默认名 */ }
      var mime = /^audio\//.test(blob.type) ? blob.type : mimeFromName(name);
      if (!mime) throw new Error('not-audio');
      if (blob.size > MAX_IMPORT_BYTES) {
        global.VcUI.toast('文件过大（上限 ' + fmtBytes(MAX_IMPORT_BYTES) + '）', 'error');
        return;
      }
      adoptImport(blob, mime, name);
    }).catch(function (err) {
      var msg = (err && err.message === 'not-audio')
        ? '链接返回的不是可识别的音频文件'
        : '加载失败：请检查链接可访问性（跨域资源需允许 CORS）';
      global.VcUI.toast(msg, 'error');
    });
  }

  /* ---------------- 保存 / 删除 / 恢复默认 ---------------- */

  function saveCurrent() {
    if (!state.currentId || !state.recordedBlob) return;
    var id = state.currentId;
    var blob = state.recordedBlob;
    var meta = { mime: state.recordedMime, durationMs: state.recordedMs };

      global.VoiceStore.save(id, blob, meta).then(function () {
        // 关键：写入与失效必须是同一个 clip.id，否则主页面仍会播旧缓存
        global.VoicePlayer.invalidate(id);
        global.VcBank.ping(); // 通知首页播放桥重同步（IDB 不产生 storage 事件）
      state.existingBlob = blob;
      clearDraft();
      updateSheetActions();
      return refresh();
    }).then(function () {
      global.VcUI.toast('已保存，返回主页面即自动生效', 'success');
      if (state.flow) advanceFlow(id); // 顺序录制：保存后自动进入下一个
    }).catch(function (err) {
      var msg = err && err.message ? err.message : '保存失败';
      if (/quota|exceed|容量|QuotaExceeded/i.test(msg)) {
        msg = '本地存储空间不足，请先删除其他自定义音频';
      }
      global.VcUI.toast(msg, 'error');
    });
  }

  function deleteCurrent() {
    if (!state.currentId) return;
    var id = state.currentId;
    global.VcUI.confirm('删除自定义音频', '删除后将恢复为该片段的内置音频。', '删除', '取消')
      .then(function (ok) {
        if (!ok) return;
        return global.VoiceStore.remove(id).then(function () {
          global.VoicePlayer.invalidate(id);
          global.VcBank.ping();
          // 丢弃波形缓存，避免删除后仍显示旧波形
          if (global.VcWave) global.VcWave.drop(id);
          state.existingBlob = null;
          state.recordedBlob = null;
          updateSheetActions();
          return refresh();
        }).then(function () {
          global.VcUI.toast('已删除，恢复为内置音频', 'success');
        });
      })
      .catch(function (err) {
        global.VcUI.toast(err && err.message ? err.message : '删除失败', 'error');
      });
  }

  function restoreAll() {
    var bank = currentBank || '';
    if (!bank) {
      global.VcUI.toast('歌姬尚未加载完成，无法恢复', 'warn');
      return;
    }
    global.VcUI.confirm('恢复本歌姬默认',
      '将删除歌姬「' + bank + '」的全部自定义录音，恢复为内置音频；其他歌姬的自定义不受影响。此操作不可撤销。',
      '恢复默认', '再想想')
      .then(function (ok) {
        if (!ok) return;
        // 按歌姬隔离：仅删当前 bank 前缀键（id 形如 bank:index），
        // 逐条走 remove() 以完整复用墓碑/降级语义，不用 clear() 全清
        return global.VoiceStore.list().then(function (map) {
          var prefix = bank + ':';
          var ids = [];
          for (var id in map) {
            if (Object.prototype.hasOwnProperty.call(map, id) && id.indexOf(prefix) === 0) ids.push(id);
          }
          return Promise.all(ids.map(function (id) {
            return global.VoiceStore.remove(id);
          }));
        }).then(function () {
          global.VoicePlayer.invalidateAll(); // 保守全失效：其余歌姬缓存重播时重建即可
          global.VcBank.ping();
          // 恢复默认：清空本歌姬全部波形缓存
          if (global.VcWave) {
            for (var w = 0; w < ids.length; w++) global.VcWave.drop(ids[w]);
          }
          state.existingBlob = null;
          state.recordedBlob = null;
          updateSheetActions();
          return refresh();
        }).then(function () {
          global.VcUI.toast('已恢复「' + bank + '」为内置音频', 'success');
        });
      })
      .catch(function (err) {
        global.VcUI.toast(err && err.message ? err.message : '操作失败', 'error');
      });
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    el.list = $('clipList');
    el.sheet = $('sheet');
    el.sheetTitle = $('sheetTitle');
    el.sheetUsage = $('sheetUsage');
    el.sheetHint = $('sheetHint');
    el.hintState = $('hintState');
    el.timer = $('recordTimer');
    el.levelFill = $('levelFill');
    el.btnRecord = $('btnRecord');
    el.btnPlayOriginal = $('btnPlayOriginal');
    el.btnPlayMine = $('btnPlayMine');
    el.btnSave = $('btnSave');
    el.btnDelete = $('btnDelete');
    el.btnRedo = $('btnRedo');
    el.btnImportFile = $('btnImportFile');
    el.fileImport = $('fileImport');
    el.importUrl = $('importUrl');
    el.btnImportUrl = $('btnImportUrl');
    el.importInfo = $('importInfo');
    el.btnCloseSheet = $('btnCloseSheet');
    el.btnRestoreAll = $('btnRestoreAll');
    el.status = $('statusText');
    el.bankLabel = $('bankLabel');
    el.sheetProgress = $('sheetProgress');
    el.btnSkip = $('btnSkip');
    el.btnFlowStart = $('btnFlowStart');
    el.btnFlowStop = $('btnFlowStop');

    if (!el.list) return;

    el.btnRecord.addEventListener('click', toggleRecord);
    el.btnPlayOriginal.addEventListener('click', playOriginal);
    el.btnPlayMine.addEventListener('click', playMine);
    el.btnSave.addEventListener('click', saveCurrent);
    el.btnDelete.addEventListener('click', deleteCurrent);
    el.btnRedo.addEventListener('click', function () {
      stopPreview();
      clearDraft();
      updateSheetActions();
      // 麦克风可用才自动进入录音；仅支持导入的环境（无麦克风/非安全上下文）只清草稿
      if (global.VoiceRecorder.isSupported()) startRecording();
    });
    el.btnImportFile.addEventListener('click', function () { el.fileImport.click(); });
    el.fileImport.addEventListener('change', onFilePicked);
    el.btnImportUrl.addEventListener('click', importFromUrl);
    el.importUrl.addEventListener('keydown', function (ev) {
      var k = ev.key || '';
      if (k === 'Enter' || ev.keyCode === 13) { ev.preventDefault(); importFromUrl(); }
    });
    el.btnCloseSheet.addEventListener('click', closeSheet);
    if (el.sheet) {
      var mask = el.sheet.querySelector('.vc-sheet__mask');
      if (mask) mask.addEventListener('click', closeSheet);
    }
    el.btnRestoreAll.addEventListener('click', restoreAll);
    if (el.btnSkip) el.btnSkip.addEventListener('click', skipCurrent);
    if (el.btnFlowStart) el.btnFlowStart.addEventListener('click', startFlow);
    if (el.btnFlowStop) el.btnFlowStop.addEventListener('click', function () { stopFlow(false); });
    updateFlowButtons();

    // 整合版：先按 ?bank= > vc:lastBank > mikuv4x 解析歌姬并加载片段清单，
    // 成功后再初始化存储与渲染列表（clips.js 内部已处理失败回退 mikuv4x）
    var bank = global.VcBank.resolve();
    global.VoiceClips.load(bank).then(function (actualBank) {
      currentBank = actualBank;
      if (el.bankLabel) el.bankLabel.textContent = '当前歌姬：' + actualBank;
      return global.VoiceStore.init();
    }).then(function () {
      return refresh();
    }).catch(function (err) {
      el.status.textContent = '歌姬配置加载失败';
      el.status.className = 'status-bar__text status-bar__text--warn';
      global.VcUI.toast('歌姬配置加载失败：' + (err && err.message ? err.message : ''), 'error');
    });

    // 录音能力自检：不支持时明确告知，而不是让用户点了才发现
    if (!global.VoiceRecorder.isSupported()) {
      global.VcUI.toast('当前环境不支持录音，仍可试听原声、导入音频与删除已有音频', 'warn', 3600);
    } else if (!global.VoiceRecorder.isSecure()) {
      global.VcUI.toast('当前非 HTTPS 环境，录音可能被浏览器拒绝', 'warn', 3600);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
