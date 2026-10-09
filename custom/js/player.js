/*!
 * player.js —— 播放解析："有自定义则播录音，否则播内置"
 *
 * 核心规则（主页面与自定义页共用，保证两页行为一致）：
 *   resolve(id) → 先查 VoiceStore；命中则用录音 Blob 生成 objectURL，否则回落到 clip.src。
 *
 * 缓存与失效：
 *   objectURL 会占用内存，必须复用并在失效时 revoke，不能每次播放都新建。
 *   约定：任何 save/remove/clear 之后，调用方必须调用 invalidate(id)（或 invalidateAll()）。
 *   这是"写入 key == 读取 key"的配对要求——写的是 clip.id，失效的也必须是同一个 clip.id。
 */
(function (global) {
  'use strict';

  // 约 10ms 静音 WAV，用于首次用户手势解锁 iOS 音频
  var SILENT_WAV = 'data:audio/wav;base64,UklGRtwBAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YbgBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

  var cache = {};   // clipId -> { url, isCustom, durationMs, updatedAt }
  var unlocked = false;

  function findClip(id) {
    var fn = global.VoiceClips && global.VoiceClips.find;
    return fn ? fn(id) : null;
  }

  /** 释放并清除某个片段的缓存（保存/删除后必须调用） */
  function invalidate(id) {
    var item = cache[id];
    if (item && item.isCustom && item.url && global.URL && global.URL.revokeObjectURL) {
      try { global.URL.revokeObjectURL(item.url); } catch (e) { /* noop */ }
    }
    delete cache[id];
  }

  function invalidateAll() {
    for (var id in cache) {
      if (Object.prototype.hasOwnProperty.call(cache, id)) invalidate(id);
    }
  }

  /**
   * 解析某个片段当前应该播放的音频源。
   * 返回 { url, isCustom, durationMs, updatedAt, clip }
   */
  function resolve(id) {
    var clip = findClip(id);
    if (!clip) return Promise.reject(new Error('未知音频片段: ' + id));
    if (cache[id]) {
      var c = cache[id];
      return Promise.resolve({
        url: c.url, isCustom: c.isCustom,
        durationMs: c.durationMs, updatedAt: c.updatedAt, clip: clip
      });
    }
    return global.VoiceStore.get(id).then(function (rec) {
      if (rec && rec.blob && rec.blob.size > 0) {
        cache[id] = {
          url: global.URL.createObjectURL(rec.blob),
          isCustom: true,
          durationMs: rec.durationMs || 0,
          updatedAt: rec.updatedAt || 0
        };
      } else {
        cache[id] = { url: clip.src, isCustom: false, durationMs: 0, updatedAt: 0 };
      }
      var item = cache[id];
      return {
        url: item.url, isCustom: item.isCustom,
        durationMs: item.durationMs, updatedAt: item.updatedAt, clip: clip
      };
    });
  }

  /** 只判断"是否已自定义"，不生成 objectURL（列表页批量用，避免内存浪费） */
  function isCustom(id) {
    return global.VoiceStore.get(id).then(function (rec) {
      return !!(rec && rec.blob && rec.blob.size > 0);
    });
  }

  function unlock() {
    if (unlocked) return;
    try {
      var a = new Audio();
      a.src = SILENT_WAV;
      a.volume = 0;
      var p = a.play();
      if (p && p.then) {
        p.then(function () { unlocked = true; a.pause(); }).catch(function () { /* 未解锁也不阻塞 */ });
      } else {
        unlocked = true;
      }
    } catch (e) { /* noop */ }
  }

  /**
   * 播放某个片段。
   * @param {string} id 片段 id
   * @param {object} opts { volume, onEnded }
   */
  function play(id, opts) {
    opts = opts || {};
    return resolve(id).then(function (item) {
      return new Promise(function (resolvePlay, rejectPlay) {
        var audio;
        try {
          audio = new Audio();
        } catch (e) {
          rejectPlay(new Error('当前浏览器不支持音频播放'));
          return;
        }
        audio.src = item.url;
        audio.preload = 'auto';
        if (typeof opts.volume === 'number') audio.volume = opts.volume;
        audio.onended = function () {
          if (opts.onEnded) opts.onEnded(item);
          resolvePlay(item);
        };
        audio.onerror = function () {
          rejectPlay(new Error('播放失败：' + (item.clip && item.clip.name ? item.clip.name : id)));
        };
        var p = audio.play();
        if (p && p.catch) {
          p.catch(function (err) {
            // iOS/部分安卓在非用户手势中调用会被拒绝
            rejectPlay(new Error('播放被浏览器拦截，请在页面内点击后重试'));
          });
        }
      });
    });
  }

  /** 直接播放内置原声（用于"试听原声"，绕过自定义） */
  function playOriginal(id, opts) {
    var clip = findClip(id);
    if (!clip) return Promise.reject(new Error('未知音频片段: ' + id));
    opts = opts || {};
    return new Promise(function (res, rej) {
      var a = new Audio();
      a.src = clip.src;
      a.preload = 'auto';
      if (typeof opts.volume === 'number') a.volume = opts.volume;
      a.onended = function () { res({ url: clip.src, isCustom: false, clip: clip }); };
      a.onerror = function () { rej(new Error('原声播放失败')); };
      var p = a.play();
      if (p && p.catch) p.catch(function () { rej(new Error('播放被浏览器拦截，请点击后重试')); });
    });
  }

  global.VoicePlayer = {
    resolve: resolve,
    isCustom: isCustom,
    play: play,
    playOriginal: playOriginal,
    invalidate: invalidate,
    invalidateAll: invalidateAll,
    unlock: unlock
  };
})(window);
