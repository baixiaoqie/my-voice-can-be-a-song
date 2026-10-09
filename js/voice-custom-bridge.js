/*!
 * voice-custom-bridge.js —— 自定义音频播放桥（首页侧）
 *
 * 挂接点：js/modules/audio.js 的 WebAudioManager.play() 内
 *   if (this.__vcbBank && window.VoiceCustomBridge &&
 *       window.VoiceCustomBridge.play(this.__vcbBank, index, delay, volume)) return;
 *
 * 职责：
 *   1. 通过 VoiceStore（custom/js/storage.js，与自定义页共用同一份存储语义）
 *      把当前歌姬 bank 下所有 `bank:index` 自定义录音读成 objectURL 缓存；
 *   2. play(bank, index, ...) 命中缓存 → HTMLAudio 播放并返回 true（跳过原声）；
 *      未命中：默认返回 false → 原项目默认播放行为完全不变；
 *      严格模式（strictOnly=true，用于首页「我的声音」选项）下未命中返回 true（静音占位，绝不回退内置原声）；
 *   3. 自定义页与首页同域共享 IndexedDB，但 IDB 不产生 storage 事件，
 *      因此自定义页保存后写 LS 哨兵 `vcb:ping`，本页监听 storage / pageshow 重同步。
 *
 * 说明：
 *   - delay（节拍对齐）仅对 WebAudio 精准调度有效，自定义音频用 HTMLAudio 立即播放，
 *     对录制/导入内容可接受；
 *   - "*自定义*"（本地上传歌姬 JSON）没有对应的数据文件，不参与替换，直接回退默认；
 *   - 音乐轨道实例无 __vcbBank 标记，天然不受本桥影响。
 */
(function (global) {
    'use strict';

    var cache = {};        // 'bank:index' -> objectURL
    var currentBank = null;
    var syncSeq = 0;       // 防竞态：切歌姬后丢弃过期的 list 结果
    var strictOnly = false; // 严格模式：true 时未录制片段静音（不回退内置），用于「我的声音」

    function revoke(key) {
        if (cache[key] && global.URL && global.URL.revokeObjectURL) {
            try { global.URL.revokeObjectURL(cache[key]); } catch (e) { /* noop */ }
        }
        delete cache[key];
    }

    function revokeAll() {
        for (var k in cache) {
            if (Object.prototype.hasOwnProperty.call(cache, k)) revoke(k);
        }
    }

    /** 用最新存储结果重建当前 bank 的缓存（先清该 bank 旧缓存，再按需建 objectURL） */
    function refill(map, bank) {
        var prefix = bank + ':';
        for (var k in cache) {
            if (Object.prototype.hasOwnProperty.call(cache, k) && k.indexOf(prefix) === 0) revoke(k);
        }
        for (var id in map) {
            if (!Object.prototype.hasOwnProperty.call(map, id)) continue;
            if (id.indexOf(prefix) !== 0) continue;
            var rec = map[id];
            if (!rec || !rec.blob || rec.blob.size <= 0) continue;
            try {
                cache[id] = global.URL.createObjectURL(rec.blob);
            } catch (e) { /* noop */ }
        }
    }

    function syncBank(bank) {
        if (!bank || bank === '*自定义*') {
            currentBank = null;
            revokeAll();
            return;
        }
        if (bank !== currentBank) revokeAll();
        currentBank = bank;
        if (!global.VoiceStore) return;
        var seq = ++syncSeq;
        global.VoiceStore.list().then(function (map) {
            // 拉取期间用户又切了歌姬：丢弃过期结果
            if (seq !== syncSeq || currentBank !== bank) return;
            refill(map, bank);
        }).catch(function () { /* 存储不可用时安静回退默认音频 */ });
    }

    /** 返回 true = 已用自定义音频播放；false = 未命中，调用方走默认播放 */
    function play(bank, index, delay, volume) {
        var url = cache[bank + ':' + index];
        if (!url) return strictOnly ? true : false;
        try {
            var a = new Audio();
            a.src = url;
            if (typeof volume === 'number') {
                a.volume = Math.max(0, Math.min(1, volume));
            }
            var p = a.play();
            if (p && p.catch) p.catch(function () { /* 浏览器拦截则等同未命中 */ });
            return true;
        } catch (e) {
            return false;
        }
    }

    global.addEventListener('storage', function (ev) {
        if (ev.key === 'vcb:ping' && currentBank) syncBank(currentBank);
    });
    global.addEventListener('pageshow', function () {
        if (currentBank) syncBank(currentBank);
    });

    function setStrict(v) { strictOnly = !!v; }
    function isStrict() { return strictOnly; }

    global.VoiceCustomBridge = {
        play: play,
        syncBank: syncBank,
        setStrict: setStrict,
        isStrict: isStrict
    };
})(window);
