// audio.js —— 音频引擎模块（从原 utatap.js 抽取，#5 模块化第一步）
// 依赖全局 aidn.WebAudio（来自 www/shared/js/common-2.min.js）
//
// 支持的 media 值格式（#4 外部/相对路径模式）：
//   + "data:audio/mp3;base64,..."  —— 默认内联，离线可用
//   + "assets/0.mp3" / "https://..." —— 外部或相对路径，按需 fetch 后转 data URI
export class WebAudioManager {
    constructor() {
        this.length = 0;
        this.now = 0;
        this._size = 0;
        this._onLoadDone = null;
        this._onProgress = null;
        this._loadedJson = null;
        this._loadedFiles = [];
        this._progress = -1;
    }

    _doLoadAudio() {
        this.now = ++this._progress;
        if (this._onProgress) this._onProgress(this._progress, this._size);
        if (this._size <= this._progress) {
            if (this._onLoadDone) this._onLoadDone();
            return;
        }
        const raw = this._loadedJson[this._progress + '.mp3'];
        const audio = new aidn.WebAudio;
        this._loadedFiles[this._progress] = audio;
        loadMediaInto(raw, audio, () => this._doLoadAudio());
    }

    load(json, lengthCallback, loadDone, progressCallback) {
        this._onLoadDone = loadDone;
        this._onProgress = progressCallback;
        this._size = 0;
        for (const _ in json) this._size++;
        this.length = this._size;
        if (lengthCallback) lengthCallback(this._size);
        this._loadedJson = json;
        this._doLoadAudio();
    }

    play(index, delay, volume) {
        if (volume < 0) volume = 1;
        if (index < this._size) {
            // 自定义音频挂接：仅 vocal 实例带 __vcbBank 标记，音乐实例无标天然跳过
            if (this.__vcbBank && window.VoiceCustomBridge &&
                window.VoiceCustomBridge.play(this.__vcbBank, index, delay, volume)) return;
            this._loadedFiles[index].play(0, false, null, 0, volume, delay);
        }
    }

    stop(index) {
        if (index < this._size) {
            this._loadedFiles[index].stop();
        }
    }
}

// 将媒体值统一喂给 aidn.WebAudio：data: 直传；外链/相对路径先 fetch 转 data URI
function loadMediaInto(raw, audio, done) {
    if (typeof raw === 'string' && raw.indexOf('data:') === 0) {
        audio.load(raw, done);
        return;
    }
    fetch(raw)
        .then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.blob();
        })
        .then(blob => {
            const fr = new FileReader();
            fr.onload = () => audio.load(fr.result, done);
            fr.onerror = () => {
                console.error('音频解码失败', raw);
                done();
            };
            fr.readAsDataURL(blob);
        })
        .catch(err => {
            // 单个音频失败不应阻塞整体加载，记录错误并继续
            console.error('音频加载失败', raw, err);
            done();
        });
}
