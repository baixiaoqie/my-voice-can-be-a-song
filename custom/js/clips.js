/*!
 * clips.js —— 音频片段清单（uta-tap 整合版）
 *
 * 与 voice-customizer 原版的差异：
 *   片段不再硬编码 8 条，而是按"当前歌姬"从 ../data/vocal/<bank>.json 动态生成——
 *     id  = `bank:index`（与首页播放桥查找的键完全一致）
 *     src = 歌姬 JSON media 里对应序号的 data URI 原声
 *   storage.js / recorder.js / player.js / ui.js 因此可以零改动复用：
 *   写入键 == 读取键 == clip.id，这条配对约定不变。
 *
 * 加载时机：app-customize.js init 时先 await VoiceClips.load(bank)，
 * 成功后再渲染列表；失败回退 mikuv4x，默认歌姬也失败则抛错交给 UI 提示。
 */
(function (global) {
  'use strict';

  var CLIPS = [];
  var MAP = {};
  var KEY_MAP = {};
  var currentBank = null;
  var loadSeq = 0;    // 并发加载令牌：只有最后一次 load 才允许重建真源（审查 C1）

  function rebuild(clips) {
    CLIPS = clips || [];
    MAP = {};
    KEY_MAP = {};
    for (var i = 0; i < CLIPS.length; i++) {
      MAP[CLIPS[i].id] = CLIPS[i];
      if (CLIPS[i].key) KEY_MAP[String(CLIPS[i].key).toUpperCase()] = CLIPS[i];
    }
  }

  function fetchBank(bank) {
    var url = '../data/vocal/' + encodeURIComponent(bank) + '.json';
    return global.fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /** 歌姬 JSON → 片段数组（按键名 N.mp3 数值排序） */
  function clipsFromJson(bank, json) {
    var media = (json && json.media) ? json.media : {};
    var indices = [];
    for (var k in media) {
      if (!Object.prototype.hasOwnProperty.call(media, k)) continue;
      var m = /^(\d+)\.mp3$/i.exec(k);
      if (m) indices.push(parseInt(m[1], 10));
    }
    indices.sort(function (a, b) { return a - b; });

    var clips = [];
    for (var i = 0; i < indices.length; i++) {
      var n = indices[i];
      clips.push({
        id: bank + ':' + n,
        name: '片段 ' + (n + 1),
        usage: '主界面声音垫第 ' + (n + 1) + ' 个',
        hint: '♪',
        key: '',
        src: media[n + '.mp3'] || ''
      });
    }
    return clips;
  }

  global.VoiceClips = {
    /** 全部片段（返回副本，防止外部改坏真源） */
    all: function () { return CLIPS.slice(); },
    /** 按 id 取片段；不存在返回 null */
    find: function (id) { return MAP[id] || null; },
    /** 按键盘按键取片段 */
    byKey: function (key) { return KEY_MAP[String(key || '').toUpperCase()] || null; },
    /** 片段总数 */
    count: function () { return CLIPS.length; },
    /** 当前生效的歌姬名（load 成功后写入） */
    currentBank: function () { return currentBank; },
    /**
     * 按歌姬加载片段清单。
     * 返回 Promise<string>：成功解析出实际生效的 bank 名（可能因回退而是 mikuv4x）。
     */
    load: function (bank) {
      var seq = ++loadSeq;
      function build(actualBank, json) {
        var clips = clipsFromJson(actualBank, json);
        // 审查 C2：media 为空按加载失败处理（触发 mikuv4x 回退），避免静默显示 0 片段
        if (!clips.length) throw new Error('empty media');
        if (seq !== loadSeq) return actualBank; // 过期结果：不再重建真源
        rebuild(clips);
        currentBank = actualBank;
        return actualBank;
      }
      return fetchBank(bank).then(function (json) {
        return build(bank, json);
      }).catch(function (err) {
        if (bank !== 'mikuv4x') {
          return fetchBank('mikuv4x').then(function (json) {
            return build('mikuv4x', json);
          });
        }
        throw err;
      });
    }
  };
})(window);
