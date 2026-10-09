/*!
 * storage.js —— 录音数据本地持久化
 *
 * 存储方案（三级降级，保证"浏览器兼容性"这条硬要求）：
 *   ① IndexedDB（首选）：直接存 Blob，容量大（通常几百 MB），不占 localStorage 配额。
 *   ② localStorage（回退）：Base64 编码后存字符串。容量约 5MB，短录音够用；
 *      写入超限会抛出明确错误，由 UI 提示，绝不静默丢数据。
 *   ③ 内存（最后兜底）：极老/隐私模式下，仅当次会话有效，页面刷新即失效，UI 会提示。
 *
 * 数据模型（IndexedDB store 'recordings'，keyPath = 'id'）：
 *   { id, blob, mime, durationMs, updatedAt }
 *   —— id 即 clips.js 中的片段 id，与内置音频 1:1 对应。
 *
 * ── 降级语义（本文件最容易写错的地方，单独说明）────────────────────────
 * 降级只是"不再信任 IDB 的写入"，不等于"IDB 里的历史数据作废"。
 * 如果把 db 直接置空，降级前录好的音频会在 UI 上凭空消失，用户会以为数据丢了。
 * 因此降级后保留 db 引用，只做**只读回捞**，并与 localStorage 结果合并（本地优先）。
 *
 * 回捞带来的对称问题：删掉的录音可能被回捞"复活"。
 * 解决办法是墓碑（tombstone）——降级态下删除某个 id 时记一笔墓碑，
 * 回捞时跳过墓碑 id；直到用户重新录制该片段（save）才撤销墓碑。
 * 墓碑同时写入 localStorage，保证刷新后依然有效。
 */
(function (global) {
  'use strict';

  var DB_NAME = 'voice_customizer';
  var DB_VERSION = 1;
  var STORE = 'recordings';
  var LS_PREFIX = 'vcr:';        // 录音数据
  var TS_PREFIX = 'vcrdel:';     // 墓碑标记（注意：不以 'vcr:' 开头，lsClear 不会误删）

  var db = null;
  var mode = 'unknown'; // 'indexeddb' | 'localstorage' | 'memory'
  var memStore = {};
  var initPromise = null;
  var tombstones = {}; // clipId -> true

  /* ---------------- 能力探测 ---------------- */

  function idbFactory() {
    try {
      return global.indexedDB || global.webkitIndexedDB || global.mozIndexedDB || null;
    } catch (e) {
      return null;
    }
  }

  function hasLocalStorage() {
    try {
      var s = global.localStorage;
      if (!s) return false;
      s.setItem('__vc_probe__', '1');
      s.removeItem('__vc_probe__');
      return true;
    } catch (e) {
      return false;
    }
  }

  function openDB() {
    return new Promise(function (resolve, reject) {
      var factory = idbFactory();
      if (!factory) { reject(new Error('indexedDB unavailable')); return; }
      var req;
      try {
        req = factory.open(DB_NAME, DB_VERSION);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('indexedDB open failed')); };
      req.onblocked = function () { reject(new Error('indexedDB blocked')); };
    });
  }

  /* ---------------- 墓碑 ---------------- */

  function markTombstone(id) {
    if (!id) return;
    tombstones[id] = true;
    try {
      if (hasLocalStorage()) global.localStorage.setItem(TS_PREFIX + id, '1');
    } catch (e) { /* 写不进去也无所谓，至少内存里这一轮是生效的 */ }
  }

  function unmarkTombstone(id) {
    if (!id) return;
    delete tombstones[id];
    try {
      if (hasLocalStorage()) global.localStorage.removeItem(TS_PREFIX + id);
    } catch (e) { /* noop */ }
  }

  function loadTombstones() {
    if (!hasLocalStorage()) return;
    try {
      for (var i = 0; i < global.localStorage.length; i++) {
        var k = global.localStorage.key(i);
        if (k && k.indexOf(TS_PREFIX) === 0) tombstones[k.slice(TS_PREFIX.length)] = true;
      }
    } catch (e) { /* noop */ }
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    if (initPromise) return initPromise;
    initPromise = new Promise(function (resolve) {
      loadTombstones();
      var factory = idbFactory();
      if (!factory) {
        resolve(decideFallback());
        return;
      }
      openDB().then(function (d) {
        db = d;
        mode = 'indexeddb';
        resolve(mode);
      }).catch(function () {
        resolve(decideFallback());
      });
    });
    return initPromise;
  }

  function decideFallback() {
    mode = hasLocalStorage() ? 'localstorage' : 'memory';
    return mode;
  }

  /**
   * IndexedDB 运行时出错时降级。
   * 刻意**不清空 db**：保留它才能只读回捞降级前的历史录音。
   */
  function demote() {
    mode = hasLocalStorage() ? 'localstorage' : 'memory';
    return mode;
  }

  /* ---------------- Blob <-> Base64 ---------------- */

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || '');
        var i = s.indexOf(',');
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      fr.onerror = function () { reject(fr.error || new Error('read blob failed')); };
      fr.readAsDataURL(blob);
    });
  }

  function base64ToBlob(b64, mime) {
    var bin = global.atob(b64);
    var len = bin.length;
    var arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || '' });
  }

  /* ---------------- IndexedDB 原子操作 ---------------- */

  function idbPut(rec) {
    return new Promise(function (resolve, reject) {
      var tx;
      try {
        tx = db.transaction(STORE, 'readwrite');
      } catch (e) {
        reject(e);
        return;
      }
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = function () { resolve(rec); };
      tx.onerror = function () { reject(tx.error || new Error('idb put failed')); };
      tx.onabort = function () { reject(tx.error || new Error('idb put aborted')); };
    });
  }

  function idbGet(id) {
    return new Promise(function (resolve, reject) {
      var tx;
      try {
        tx = db.transaction(STORE, 'readonly');
      } catch (e) {
        reject(e);
        return;
      }
      var req = tx.objectStore(STORE).get(id);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error || new Error('idb get failed')); };
    });
  }

  function idbGetAll() {
    return new Promise(function (resolve, reject) {
      var tx;
      try {
        tx = db.transaction(STORE, 'readonly');
      } catch (e) {
        reject(e);
        return;
      }
      var req = tx.objectStore(STORE).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error || new Error('idb getAll failed')); };
    });
  }

  function idbDelete(id) {
    return new Promise(function (resolve, reject) {
      var tx;
      try {
        tx = db.transaction(STORE, 'readwrite');
      } catch (e) {
        reject(e);
        return;
      }
      tx.objectStore(STORE)['delete'](id);
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error || new Error('idb delete failed')); };
    });
  }

  function idbClear() {
    return new Promise(function (resolve, reject) {
      var tx;
      try {
        tx = db.transaction(STORE, 'readwrite');
      } catch (e) {
        reject(e);
        return;
      }
      tx.objectStore(STORE).clear();
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error || new Error('idb clear failed')); };
    });
  }

  /* ---------------- 降级后的"尽力而为"IDB 访问 ----------------
   * 成功就用，失败静默忽略，绝不阻塞主流程；一律过滤墓碑。
   */

  function idbTryGet(id) {
    if (!db || tombstones[id]) return Promise.resolve(null);
    return idbGet(id).catch(function () { return null; });
  }

  function idbTryAll() {
    if (!db) return Promise.resolve([]);
    return idbGetAll().catch(function () { return []; }).then(function (rows) {
      var out = [];
      for (var i = 0; i < rows.length; i++) {
        if (rows[i] && !tombstones[rows[i].id]) out.push(rows[i]);
      }
      return out;
    });
  }

  /* ---------------- localStorage / 内存 ---------------- */

  function lsPut(rec) {
    return blobToBase64(rec.blob).then(function (b64) {
      var payload = {
        mime: rec.mime,
        durationMs: rec.durationMs,
        updatedAt: rec.updatedAt,
        bytes: rec.blob.size,
        data: b64
      };
      global.localStorage.setItem(LS_PREFIX + rec.id, JSON.stringify(payload));
      return rec;
    });
  }

  function lsGet(id) {
    var raw = global.localStorage.getItem(LS_PREFIX + id);
    if (!raw) return Promise.resolve(null);
    try {
      var p = JSON.parse(raw);
      return Promise.resolve({
        id: id,
        blob: base64ToBlob(p.data, p.mime),
        mime: p.mime,
        durationMs: p.durationMs || 0,
        updatedAt: p.updatedAt || 0
      });
    } catch (e) {
      // 数据损坏：清掉脏数据，避免持续报错
      global.localStorage.removeItem(LS_PREFIX + id);
      return Promise.resolve(null);
    }
  }

  function lsDelete(id) {
    global.localStorage.removeItem(LS_PREFIX + id);
    return Promise.resolve(true);
  }

  function lsClear() {
    var keys = [];
    for (var i = 0; i < global.localStorage.length; i++) {
      var k = global.localStorage.key(i);
      // 只清录音数据，墓碑标记要留着，否则下次刷新被删的录音会被回捞复活
      if (k && k.indexOf(LS_PREFIX) === 0) keys.push(k);
    }
    keys.forEach(function (k) { global.localStorage.removeItem(k); });
    return Promise.resolve(true);
  }

  /* ---------------- 写入 ---------------- */

  function save(id, blob, meta) {
    if (!id) return Promise.reject(new Error('save: missing id'));
    if (!blob) return Promise.reject(new Error('save: missing blob'));
    return init().then(function () {
      // 重新录制 = 用户明确要这个片段有声音，撤销墓碑
      unmarkTombstone(id);
      var rec = {
        id: id,
        blob: blob,
        mime: (meta && meta.mime) || blob.type || 'audio/wav',
        durationMs: (meta && meta.durationMs) || 0,
        updatedAt: Date.now()
      };
      if (mode === 'indexeddb' && db) {
        return idbPut(rec).catch(function () {
          demote();
          if (mode === 'localstorage') return lsPut(rec);
          memStore[id] = rec;
          return rec;
        });
      }
      if (mode === 'localstorage') return lsPut(rec);
      memStore[id] = rec;
      return rec;
    });
  }

  /* ---------------- 读取 ---------------- */

  function get(id) {
    if (!id) return Promise.resolve(null);
    return init().then(function () {
      if (mode === 'indexeddb' && db) {
        if (tombstones[id]) return null;
        return idbGet(id).catch(function () {
          demote();
          if (mode === 'localstorage') return lsGet(id);
          return memStore[id] || null;
        });
      }
      var p = (mode === 'localstorage') ? lsGet(id) : Promise.resolve(memStore[id] || null);
      return p.then(function (rec) {
        // 降级前录在 IDB 里的历史录音，本地没有时回捞一次，避免"录音凭空消失"
        if (rec || mode !== 'localstorage') return rec;
        return idbTryGet(id);
      });
    });
  }

  /** 返回 { [clipId]: rec } —— 主页面批量判断"哪些已被自定义" */
  function list() {
    return init().then(function () {
      var out = {};
      if (mode === 'indexeddb' && db) {
        return idbGetAll().catch(function () {
          // 降级路径：collectLocal() 返回 {id: rec} 对象 map，而 IDB 路径是数组。
          // 曾把 map 当数组消费（rows.length 为 undefined）导致 LS 数据被整体丢弃，
          // 因此两个分支必须在此归一后再合并（复审 N1 修复）。
          demote();
          return collectLocal();
        }).then(function (rowsOrMap) {
          if (!Array.isArray(rowsOrMap)) return mergeIdbHistory(rowsOrMap);
          for (var i = 0; i < rowsOrMap.length; i++) {
            if (rowsOrMap[i] && !tombstones[rowsOrMap[i].id]) out[rowsOrMap[i].id] = rowsOrMap[i];
          }
          return mergeIdbHistory(out);
        });
      }
      return collectLocal().then(mergeIdbHistory);
    });
  }

  /** 本地结果优先，IDB 历史数据只在缺失时补齐 */
  function mergeIdbHistory(out) {
    if (mode !== 'localstorage') return Promise.resolve(out);
    return idbTryAll().then(function (rows) {
      for (var i = 0; i < rows.length; i++) {
        if (!out[rows[i].id]) out[rows[i].id] = rows[i];
      }
      return out;
    });
  }

  function collectLocal() {
    var out = {};
    if (mode === 'localstorage') {
      var keys = [];
      for (var i = 0; i < global.localStorage.length; i++) {
        var k = global.localStorage.key(i);
        if (k && k.indexOf(LS_PREFIX) === 0) keys.push(k);
      }
      var chain = Promise.resolve();
      keys.forEach(function (k) {
        var id = k.slice(LS_PREFIX.length);
        chain = chain.then(function () {
          return lsGet(id).then(function (rec) {
            if (rec) out[id] = rec;
          });
        });
      });
      return chain.then(function () { return out; });
    }
    // memory 模式
    for (var id in memStore) {
      if (Object.prototype.hasOwnProperty.call(memStore, id)) out[id] = memStore[id];
    }
    return Promise.resolve(out);
  }

  /* ---------------- 删除 / 清空 ---------------- */

  function remove(id) {
    if (!id) return Promise.resolve(false);
    return init().then(function () {
      if (mode === 'indexeddb' && db) {
        return idbDelete(id).catch(function () {
          demote();
          return removeDegraded(id);
        });
      }
      return removeDegraded(id);
    });
  }

  /** 降级态删除：本地删 + 记墓碑（防止 IDB 里的旧记录被回捞复活） */
  function removeDegraded(id) {
    markTombstone(id);
    if (mode === 'localstorage') lsDelete(id);
    delete memStore[id];
    return Promise.resolve(true);
  }

  /** 恢复默认音频：清空所有自定义录音 */
  function clear() {
    return init().then(function () {
      if (mode === 'indexeddb' && db) {
        return idbClear().catch(function () {
          demote();
          return clearDegraded();
        });
      }
      return clearDegraded();
    });
  }

  /** 降级态清空：先把 IDB 现存 id 全部记墓碑，再清本地 */
  function clearDegraded() {
    return idbTryAll().then(function (rows) {
      for (var i = 0; i < rows.length; i++) markTombstone(rows[i].id);
      if (mode === 'localstorage') lsClear();
      memStore = {};
      return true;
    });
  }

  global.VoiceStore = {
    init: init,
    save: save,
    get: get,
    list: list,
    remove: remove,
    clear: clear,
    /** 当前实际生效的存储后端，用于向用户提示持久化能力 */
    mode: function () { return mode; },
    /** 是否为可跨会话持久的后端（memory 模式刷新即丢） */
    isPersistent: function () { return mode === 'indexeddb' || mode === 'localstorage'; }
  };
})(window);
