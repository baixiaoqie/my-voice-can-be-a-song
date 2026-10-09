import { WebAudioManager } from './modules/audio.js';
import { validateVocal, validateMusic } from './modules/config.js';
$(function() {
    (new MainManager).init()
});
var MainManager = function() {
    aidn.util.useDummyDiv();
    var query = aidn.util.getQuery();
    var defaultVocalName = decodeURIComponent(query.vocal || "mikuv4x"),
        defaultTracksName = decodeURIComponent(query.music || query.tracks || "mikutap");
    function onWindowResize() {
        windowWidth = aidn.window.width();
        windowHeight = aidn.window.height();
        if (renderer) {
            renderer.resize(windowWidth, windowHeight);
            if (animatePlayer) animatePlayer.resize();
        }
    }
    function loadingCallback(progress, size) {
        size = vocalPlayer.length + tracksPlayer.length;
        if (loadFlag == 1) {
            // tracksPlayer 加载完毕，进度加上 tracksPlayer 的进度
            progress += tracksPlayer.length;
        }
        // 显示总进度
        var hrWidth = (size <= 0) ? "0%" : Math.round(progress / size * 100) + "%";
        $("#scene_loading hr").css("width", hrWidth);
    }
    function loadDoneCallback() {
        if (++loadFlag == 1) {
             // tracksPlayer 加载完毕，加载 vocalPlayer
            vocalPlayer.init(loadDoneCallback, loadingCallback);
        } else if (loadFlag == 2) {
             // vocalPlayer 加载完毕，开始播放
            playStart();
        }
    }
    function playStart() {
        sceneFlag = 1;
        $("#scene_loading hr").css("display", "none");
        $("#scene_loading hr").css("width", 0);
        $("#scene_loading").stop().fadeOut(200, "linear");
        if (autoRandomPlayMode) { 
            $("#scene_loading").stop().css("display", "none");
            $("#bt_back").stop().css("display", "none");
            if (enableFullscreen) $("#bt_fs").stop().css("display", "none");
            $("#scene_main .set").stop().css("display", "none");
        } else {
            $("#scene_main").stop().fadeIn(200, "linear");
        }
        lastTime = aidn.___waContext.currentTime;
        animatePlayer.start();
        tracksPlayer.start();
    }
    function onFeedbackClick(event) {
        if (settingsFeedback = !settingsFeedback) {
            $("#bt_feedback a").text("反馈: 开启");
            aidn.util.setCookie("fb", "on", 2592e3);
        } else {
            $("#bt_feedback a").text("反馈: 关闭");
            aidn.util.setCookie("fb", "off", 2592e3);
        }
        if (event) event.preventDefault();
    }
    function onBgMusicClick(event) {
        if (settingsBackgroundTrack = !settingsBackgroundTrack) {
            $("#bt_backtrack a").text("背景音乐: 开启");
            aidn.util.setCookie("bt", "on", 2592e3);
        } else {
            $("#bt_backtrack a").text("背景音乐: 关闭");
            aidn.util.setCookie("bt", "off", 2592e3);
        }
        if (event) event.preventDefault();
    }
    
    var l = 0, h = 0, f = 0, c = [], d = Math.floor(32 * Math.random());
    for (var u = 0; u < 32; u++) {
        c[u] = u;
    }
    function update() {
        if (tracksPlayer) tracksPlayer.update();
        if (sceneFlag == 1 && --D < 0) {
            showIdleScreen();
        }
        if (sceneFlag == 1 && autoRandomPlayMode) {
            var n = 1e3 * (aidn.___waContext.currentTime - lastTime);
            if (l * gapTime < n) {
                var a = Math.floor(n / gapTime) + 1;
                h += a - l;
                var e = (l = a) * gapTime - n;
                if (0 <= e) {
                    var t = Math.random(), i = 1;
                    if (h >= 192) {
                        h = 0;
                    } else if (h >= 128) {
                        if (t < 0.7) i = 2;
                        if (t < 0.5) i = 3;
                    } else if (h >= 64) {
                        if (t < 0.35) i = 2;
                        if (t < 0.2) i = 3;
                        if (t < 0.02) i = 0;
                    } else if (h >= 32) {
                        if (t < 0.35) i = 2;
                        if (t < 0.24) i = 0;
                    } else if (h >= 0) {
                        if (t < 0.4) i = 0;
                    }
                    for (var o = 0; o < i; o++) {
                        d = c[f];
                        if (++f >= 32) {
                            f = 0;
                            aidn.util.shuffleArray(c);
                        }
                        animatePlayer.changeId(d, 0, true);
                    }
                }
            }
        }
        renderer.render(renderContainer);
        window.requestAnimFrame(update);
    }
    this.init = function() {
        aidn.window.addDummyDiv();
        try {
            aidn.adv.show();
        } catch (n) {}
        var resolution = parseInt(window.devicePixelRatio * 2);
        renderer = PIXI.autoDetectRenderer(windowWidth, windowHeight, {
            backgroundColor: 0xFFAFAF,
            resolution: resolution
        });
        renderer.autoDensity = true;
        renderer.resolution = resolution;
        renderer.options.antialias = true;
        renderer.options.autoDensity = true;
        document.getElementById("view").appendChild(renderer.view);
        renderContainer = new PIXI.Container;
        animatePlayer.init();
        onWindowResize();
        $("#scene_top").fadeIn(300);
        update();
    };
    var bpm = 140, gapTime;
    function updateGapTime() {
        // 根据 bpm 更新音符间隔时间
        gapTime = 6e4 / bpm / 2;
    }
    updateGapTime();
    
    var colorMap = [], overrideColor = false;
    function useDefaultColorMap() {
        overrideColor = false;
        colorMap = [0xCCEEEE, 0x88CCCC, 0x8AD9EC, 0x0EAA9D, 0x109FB1, 0x008899, 0xD49E9E, 0xF5D4C8, 0xEC5685, 0xFC3E77, 0x594F57, 0x312B2D];
    }
    useDefaultColorMap();
    function resolveColorMapOverride(json) {
        if (!json) return;
        overrideColor = true;
        colorMap = [];
        json.forEach(function(str) {
            if (str.indexOf("#") == 0) {
                var color = parseInt(str.substr(1), 16)
                if (color != undefined) colorMap.push(color);
            }
        });
    }

    function showIdleScreen() {
        if (!autoRandomPlayMode && !isUserIdle) {
            isUserIdle = true;
            $("#bt_back").stop().fadeIn(200, "linear");
            if (enableFullscreen) $("#bt_fs").stop().fadeIn(200, "linear");
            $("#scene_main .set").stop().fadeIn(200, "linear");
        }
    }
    var autoRandomPlayMode = query.auto == 1;
    aidn.util.needExpandArea(true);
    var enableFullscreen = aidn.util.enabledFullscreen();
    if (enableFullscreen) {
        $("#bt_fs").css("display", "block");
        $("#bt_fs").click(function(n) {
            aidn.util.fullscreen();
        });
    }
    $("#bt_start a").click(function(n) {
        // 模式二：点「开始」时先收掉像素首页覆盖层，
        // 再执行原项目的加载链。这样不需要在 canvas 上另做一套按钮逻辑。
        if (window.__MODE_B_CLOSE_PIXEL__) {
            window.__MODE_B_CLOSE_PIXEL__();
        }
        if (!tracksPlayer || !vocalPlayer) {
            window.alert('还没有载入歌姬或背景音轨');
            return;
        }
        // 注意：这里不要 fadeOut #scene_top —— 它在演奏态要保留顶部导航栏。
        // 改为切到 is-playmode（仅隐藏四个入口与提示，导航栏常驻）。
        // syncNavState 内部会保证 display:block。
        syncNavState(true);
        $("#scene_loading").stop().fadeIn(200, "linear");
        if (loadFlag == 2) {
            playStart();
        } else {
            useDefaultColorMap();
            (new aidn.WebAudio).load("");
            tracksPlayer.init(loadDoneCallback, loadingCallback);
        }
        try {
            aidn.adv.hide();
        } catch (n) {}
        n.preventDefault();
    });
    $("#bt_select a").click(function(n) {
        $("#select").stop().fadeIn(200, "linear");
        $("#select_cover").stop().fadeIn(200, "linear");
        n.preventDefault();
    });
    $("#bt_close,#select_cover").click(function() {
        $("#select").stop().fadeOut(200, "linear");
        $("#select_cover").stop().fadeOut(200, "linear");
    });
    $("#bt_about a").click(function(n) {
        $("#about").stop().fadeIn(200, "linear");
        $("#about_cover").stop().fadeIn(200, "linear");
        n.preventDefault();
    });
    $("#bt_close,#about_cover").click(function() {
        $("#about").stop().fadeOut(200, "linear");
        $("#about_cover").stop().fadeOut(200, "linear");
    });
    /**
     * 同步导航栏状态：
     *   - 演奏态：#scene_top 只保留 #topbar（加 .is-playmode）
     *   - 首页态：恢复完整面板，并给「首页」项加 .at-home 禁用态
     * 这样「首页」导航项跨场景始终可见、样式一致。
     */
    function syncNavState(isPlaying) {
        var $top = $("#scene_top");
        if (isPlaying) {
            $top.addClass("is-playmode").removeClass("at-home")
                .stop().css("display", "block");
        } else {
            $top.removeClass("is-playmode").addClass("at-home")
                .stop().css("display", "block");
        }
    }

    /**
     * 回到首页。#bt_back（空壳）与 #nav_home（导航栏里的「首页」）
     * 共用这一个实现，避免两套逻辑漂移。
     */
    function goHome() {
        if (sceneFlag === 1) {
            sceneFlag = 0;
            try {
                aidn.adv.show();
            } catch (n) {}
            animatePlayer.end();
            tracksPlayer.end();
            $("#scene_loading").stop().fadeOut(100, "linear");
            $("#scene_main").stop().fadeOut(100, "linear");
            showIdleScreen();
        } else {
            try {
                animatePlayer.end();
                tracksPlayer.end();
            } catch (n) {}
        }
        syncNavState(false);
        // 模式二：重新盖上像素首页（原首页真实按钮浮在其上）
        if (window.__MODE_B__ && window.__MODE_B__.showPixelHome) {
            window.__MODE_B__.showPixelHome();
        } else {
            $("#scene_top").stop().fadeIn(100, "linear");
        }
    }
    $("#bt_back").click(goHome);
    // 顶部导航栏的「首页」项：与 #bt_back 同一行为
    $("#nav_home").click(function (e) {
        e.preventDefault();
        goHome();
    });
    $("#bt_feedback a").click(onFeedbackClick);
    $("#bt_backtrack a").click(onBgMusicClick);
    function updateSelectState() {
        $('.option, .custom') .removeClass('selected');
        if (currentTracksName == '*自定义*') {
            var tracks = $('input[type="radio"][name="tracks"]');
            for (var i = 0; i < tracks.length; i++) {
                tracks[i].checked = false;
            }
            $("#file_music").parent().addClass('selected');
        } else {
            $('input[type="radio"][name="tracks"][value="' + currentTracksName + '"]').parent().addClass('selected');
        }
        if (currentVocalName == "*自定义*") {
            var vocals = $('input[type="radio"][name="vocals"]');
            for (var i = 0; i < vocals.length; i++) {
                vocals[i].checked = false;
            }
            $("#file_vocal").parent().addClass('selected');
        } else {
            var selVocal = $('input[type="radio"][name="vocals"]').filter(function() {
                return this.value === currentVocalName;
            });
            selVocal.parent().addClass('selected');
        }
        $("#file_music").val('');
        $("#file_vocal").val('');
    }
    function loadSelectList() {
        fetch("data/music.txt", {cache: "no-store"})
		.then(resp => resp.status == 200 ? resp.text() : null)
        .then(text => {
            if (text == null) { window.alert("背景音轨列表加载失败（data/music.txt 缺失）"); return; }
            var tracks = $("#tracks");
            tracks[0].innerHTML = "";
            var lines = text.split('\n')
            for (var i in lines) {
                var str = lines[i].replace('.json', '');
                if (str.trim().length > 0) {
                    if (str == defaultTracksName) loadMusicTracksFromName(str);
                    var checked = currentTracksName == str ? " checked" : "";
                    tracks.append(
`<li class="option">
    <input type="radio" name="tracks" id="${str}" value="${str}"${checked}>
    <label for="${str}">${str}</label>
</li>`);
                }
            }
            updateSelectState();
            $('input[name="tracks"]').change(function() {
                let selectedValue = $(this).val();
                loadMusicTracksFromName(selectedValue);
            });
        })
        .catch(function(err) {
            console.error(err);
            window.alert("背景音轨列表加载失败，请检查网络或部署");
        });
        fetch("data/vocal.txt", {cache: "no-store"})
		.then(resp => resp.status == 200 ? resp.text() : null)
        .then(text => {
            if (text == null) { window.alert("歌姬列表加载失败（data/vocal.txt 缺失）"); return; }
            var vocals = $("#vocals");
            vocals[0].innerHTML = "";
            // 顶部插入「我的声音」选项：基础 bank = vc:lastBank（兜底默认歌姬），未录制片段静音
            vocals.prepend(
`<li class="option" id="vc-mine-li">
    <input type="radio" name="vocals" id="vc-mine" value="*我的声音*">
    <label for="vc-mine">我的声音</label>
</li>`);
            var lines = text.split('\n')
            for (var i in lines) {
                var str = lines[i].replace('.json', '');
                if (str.trim().length > 0) {
                    if (str == defaultVocalName) loadVocalFromName(str);
                    var checked = currentVocalName == str ? " checked" : "";
                    vocals.append(
`<li class="option">
    <input type="radio" name="vocals" id="${str}" value="${str}"${checked}>
    <label for="${str}">${str}</label>
</li>`);
                }
            }
            updateSelectState();
            $('input[name="vocals"]').change(function() {
                let selectedValue = $(this).val();
                if (selectedValue === "*我的声音*") {
                    loadVocalMine();
                } else {
                    loadVocalFromName(selectedValue);
                }
            });
        })
        .catch(function(err) {
            console.error(err);
            window.alert("歌姬列表加载失败，请检查网络或部署");
        });
    }
    loadSelectList();
    $("#file_music").on('change', function() {
        var file = $(this).prop('files')[0];
        var reader = new FileReader();
        reader.onload = function(e) {
            var content = e.target.result;
            loadMusicTracksFromJson(content);
        };
        reader.readAsText(file);
    });
    $("#file_vocal").on('change', function() {
        var file = $(this).prop('files')[0];
        var reader = new FileReader();
        reader.onload = function(e) {
            var content = e.target.result;
            loadVocalFromJson(content);
        };
        reader.readAsText(file);
    });
    var windowWidth, windowHeight, isMobile = aidn.util.checkMobile();
    var lastTime, renderer, renderContainer, loadFlag = 0, sceneFlag = 0;
    var tracksPlayer, currentTracksName, vocalPlayer, currentVocalName;
    var currentVocalBank = null; // 「我的声音」的基础歌姬 bank（vc:lastBank 或默认 mikuv4x）
    function resolveFromJson(jsonArray, target) {
        if (jsonArray) for (var i in jsonArray) {
            var j = i.indexOf('.mp3');
            if (j > 0) {
                var k = parseInt(i.substring(0, j));
                if (k != undefined) {
                    target[k] = jsonArray[i];
                }
            }
        }
    }
    function loadMusicTracksFromName(tracksName) {
        currentTracksName = tracksName;
        updateSelectState();
        loadMusicTracks(function(done) {
            $.getJSON("data/music/" + tracksName + ".json", done)
             .fail(function() {
                 console.error("背景音轨配置加载失败", tracksName);
                 window.alert("背景音轨「" + tracksName + "」加载失败");
             });
        })
    }
    function loadMusicTracksFromJson(json) {
        var loadedJson;
        try {
            loadedJson = $.parseJSON(json);
        } catch(e) {
            console.error(e);
            window.alert("背景音轨配置加载错误：JSON 解析失败");
            return;
        }
        var errMsg = validateMusic(loadedJson);
        if (errMsg) {
            console.error("背景音轨配置校验失败", errMsg, loadedJson);
            window.alert("背景音轨配置无效：" + errMsg);
            return;
        }
        currentTracksName = "*自定义*";
        updateSelectState();
        loadMusicTracks(function(done) {
            done(loadedJson);
        })
    }
    function loadMusicTracks(jsonProvider) {
        loadFlag = 0;
        sceneFlag = 0;
        tracksPlayer = new function() {
            var audioPlayer, playing = false,
                volume = [], tracks = [], player = this,
                trackLength, progress = 0;
            this.init = function(loadDone, progressCallback) {
                jsonProvider(function (json) {
                    audioPlayer = new WebAudioManager;
                    audioPlayer.load(json.media, function(len) {
                        player.length = len;
                    }, function() {
                        if (loadDone) loadDone();
                    }, function(n, a) {
                        if (progressCallback) progressCallback(n, a);
                    });

                    resolveColorMapOverride(json.color_map);

                    var v = json.volume;
                    var defV = v ? v.default : 1;
                    for (var n = 0; n < player.length; n++) {
                        volume[n] = defV;
                    }
                    resolveFromJson(v, volume);

                    if (json.bpm != undefined) {
                        bpm = json.bpm;
                        updateGapTime();
                    }

                    tracks = [];
                    trackLength = 0;
                    for (var i in json.tracks) {
                        var trackInfo = json.tracks[i];
                        if (trackLength < trackInfo.notes.length) {
                            trackLength = trackInfo.notes.length;
                        }
                    }
                    for (var i in json.tracks) {
                        var trackInfo = json.tracks[i];
                        if (trackInfo.loop) {
                            var track = [];
                            var notes = trackInfo.notes.length;
                            for (var i = 0; i < trackLength; i++) {
                                track.push(trackInfo.notes[i % notes]);
                            }
                            tracks.push(track);
                        } else {
                            tracks.push(trackInfo.notes);
                        }
                    }
                });
            };
            this.update = function() {
                if (!playing) return;
                var n = 1e3 * (aidn.___waContext.currentTime - lastTime);
                if (progress * gapTime < n) {
                    var delay = (progress = Math.floor(n / gapTime) + 1) * gapTime - n;
                    if (0 <= delay && settingsBackgroundTrack) {
                        for (var e = (progress - 1) % trackLength, t = tracks.length, i = 0; i < t; i++) {
                            var note = tracks[i][e];
                            if (note >= 0) {
                                audioPlayer.play(note, delay / 1e3, volume[note])
                            }
                        }
                    }
                }
            };
            this.start = function() {
                playing = true;
                progress = 0;
            };
            this.end = function() {
                playing = false;
                progress = 0;
            };
        };
    }
    function loadVocalFromName(vocalName) {
        currentVocalName = vocalName;
        currentVocalBank = vocalName;
        updateSelectState();
        loadVocal(function(done) {
            $.getJSON("data/vocal/" + vocalName + ".json", done)
             .fail(function() {
                 console.error("歌姬配置加载失败", vocalName);
                 window.alert("歌姬「" + vocalName + "」加载失败");
             });
        })
    }
    function loadVocalFromJson(json) {
        var loadedJson;
        try {
            loadedJson = $.parseJSON(json);
        } catch(e) {
            console.error(e);
            window.alert("歌姬配置加载错误：JSON 解析失败");
            return;
        }
        var errMsg = validateVocal(loadedJson);
        if (errMsg) {
            console.error("歌姬配置校验失败", errMsg, loadedJson);
            window.alert("歌姬配置无效：" + errMsg);
            return;
        }
        currentVocalName = "*自定义*";
        currentVocalBank = null;
        updateSelectState();
        loadVocal(function(done) {
            done(loadedJson);
        })
    }
    function loadVocalMine() {
        currentVocalName = "*我的声音*";
        // 基础 bank：上一次使用的自定义 bank，兜底默认歌姬
        var bank = null;
        try { bank = localStorage.getItem('vc:lastBank'); } catch (e) {}
        if (!bank) bank = defaultVocalName;
        currentVocalBank = bank;
        updateSelectState();
        loadVocal(function(done) {
            // 用基础歌姬的内置 JSON 驱动 UI（音序/配色），实际播放全部走自定义桥严格模式
            $.getJSON("data/vocal/" + bank + ".json", done)
             .fail(function() {
                 console.error("基础歌姬配置加载失败", bank);
                 window.alert("基础歌姬「" + bank + "」加载失败");
             });
        });
    }
    function loadVocal(jsonProvider) {
        loadFlag = 0;
        sceneFlag = 0;
        vocalPlayer = new function() {
            var audioPlayer, r = -1, currentIndex = -1,
                player = this, volume = [], delay = [];
            this.init = function(loadDone, progressCallback) {
                jsonProvider(function(json) {
                    audioPlayer = new WebAudioManager;
                    // 自定义音频挂接：给 vocal 实例打标（音乐实例在 loadMusicTracks 内创建，不经过这里）
                    audioPlayer.__vcbBank = currentVocalBank || currentVocalName;
                    try {
                        // 「我的声音」是合成选项，绝不写入 vc:lastBank；其余正常歌姬记录上次使用
                        if (currentVocalName !== "*我的声音*") {
                            localStorage.setItem('vc:lastBank', currentVocalName);
                        }
                    } catch (e) {}
                    if (window.VoiceCustomBridge) {
                        window.VoiceCustomBridge.setStrict(currentVocalName === "*我的声音*");
                        window.VoiceCustomBridge.syncBank(currentVocalBank || currentVocalName);
                    }
                    audioPlayer.load(json.media, function(len) {
                        player.length = len;
                    }, function() {
                        if (loadDone) loadDone();
                    }, function(progress, size) {
                        if (progressCallback) progressCallback(progress, size);
                    });
                    
                    resolveColorMapOverride(json.color_map);

                    var d = json.d_value;
                    var v = json.volume;
                    var defD = d ? d.default : 0;
                    var defV = v ? v.default : 1;
                    delay = [], volume = [];
                    for (var n = 0; n < player.length; n++) {
                        delay[n] = defD;
                        volume[n] = defV;
                    }
                    resolveFromJson(d, delay);
                    resolveFromJson(v, volume);
                });
            };
            this.play = function(index) {
                var e = 1e3 * (aidn.___waContext.currentTime + delay[index] - lastTime);
                var t = Math.floor(e / gapTime);
                if (t == r && currentIndex >= 0) {
                    audioPlayer.stop(currentIndex);
                }
                r = t;
                currentIndex = index;
                var i = (gapTime - e % gapTime) / 1e3;
                audioPlayer.play(index, i, volume[index]);
            };
        };
    }
    var animatePlayer = new function() {
        var s = function(n, a) {
            this.id = n,
            this.setPosition = function(n, a) {
                r.position.x = e = n,
                r.position.y = t = a
            }
            ,
            this.setSize = function(n, a) {
                i = n,
                o = a,
                r.clear(),
                r.beginFill(16777215),
                r.alpha = 0,
                r.drawRect(0, 0, i, o)
            }
            ,
            this.play = function() {
                settingsFeedback && gsap.fromTo(r, .5, {
                    alpha: .7
                }, {
                    alpha: 0,
                    ease: Power0.easeNon
                })
            }
            ,
            this.hitcheck = function(n, a) {
                return e <= n && n < e + i && t <= a && a < t + o
            }
            ;
            var e = 0
              , t = 0
              , i = 0
              , o = 0
              , r = new PIXI.Graphics;
            r.interactive = true,
            a.addChild(r)
        }
          , n = function(n) {
            function a() {
                o.clear(),
                o.beginFill(16777215),
                o.drawRect(0, 0, windowWidth, windowHeight)
            }
            function e() {
                t.resize()
            }
            this.resize = function() {
                o.clear(),
                o.beginFill(i),
                o.drawRect(0, 0, windowWidth, windowHeight)
            }
            ,
            this.flash = function() {
                r.setChildIndex(o, r.children.length - 1);
                for (var n = 0; n < 3; n += 2)
                    gsap.delayedCall(.07 * n, a),
                    gsap.delayedCall(.07 * (n + 1), e)
            }
            ,
            this.setColor = function(n, a) {
                i = n,
                a = 0 <= a ? a : 0,
                r.setChildIndex(o, a),
                t.resize()
            }
            ;
            var t = this
              , i = 16777215
              , o = new PIXI.Graphics
              , r = n;
            r.addChild(o)
        }
          , d = function(n, a) {
            function e() {
                var n, a, e, t = 1.3 * d;
                if (f.clear(),
                f.beginFill(0),
                f.moveTo(0, 0),
                0 == o)
                    for (var i = 0; i < c.rotation; i += 30)
                        n = (s * i + l) * Math.PI / 180,
                        a = Math.cos(n) * t,
                        e = Math.sin(n) * t,
                        f.lineTo(a, e);
                else
                    for (i = 360; c.rotation < i; i -= 30)
                        n = (s * i + l) * Math.PI / 180,
                        a = Math.cos(n) * t,
                        e = Math.sin(n) * t,
                        f.lineTo(a, e);
                n = (s * c.rotation + l) * Math.PI / 180,
                a = Math.cos(n) * t,
                e = Math.sin(n) * t,
                f.lineTo(a, e),
                f.lineTo(0, 0),
                f.endFill()
            }
            function t() {
                o = 1,
                gsap.fromTo(c, .9, {
                    rotation: 0
                }, {
                    rotation: 360,
                    ease: Power1.easeOut,
                    onUpdate: e,
                    onComplete: i
                })
            }
            function i() {
                r && r()
            }
            this.play = function(n, a) {
                o = 0,
                d = n,
                r = a,
                l = 360 * Math.random(),
                s = 1,
                Math.random() < .5 && (s = -1),
                f.clear(),
                f.beginFill(0),
                f.moveTo(0, 0),
                f.lineTo(1, 1),
                f.endFill(),
                gsap.fromTo(c, .6, {
                    rotation: 0
                }, {
                    rotation: 360,
                    ease: Power1.easeOut,
                    onUpdate: e,
                    onComplete: t
                })
            }
            ;
            var o, r, l, s, d, h = n, c = {
                rotation: 0
            }, f = new PIXI.Graphics;
            h.addChild(f),
            a.mask = f
        }
          , r = function(n) {
            function h() {
                w.clear(),
                0 == f ? w.lineStyle(v, u) : w.beginFill(u);
                for (var n = 0; n < p; n++) {
                    var a = M["p" + n].x
                      , e = M["p" + n].y;
                    0 == n ? w.moveTo(a, e) : w.lineTo(a, e)
                }
                a = M.p0.x,
                e = M.p0.y,
                w.lineTo(a, e)
            }
            function c() {
                w.visible = false,
                e && e()
            }
            this.play = function(n, a) {
                f = n,
                e = a,
                function() {
                    y.setChildIndex(w, y.children.length - 1),
                    w.visible = true,
                    w.x = windowWidth / 2,
                    w.y = windowHeight / 2,
                    u = getRandomColor();
                    var n, a = Math.min(windowWidth, windowHeight) * (.32 * Math.random() + .16), e = Math.floor(5 * Math.random()) + 3;
                    p = e,
                    v = 5 * Math.random() + 3,
                    w.clear(),
                    w.rotation = 30 * Math.floor(6 * Math.random()),
                    M = {},
                    n = 0 == f ? 3 : 2.5;
                    for (var t = 360 / p, i = 0; i < p; i++) {
                        var o = i * t * Math.PI / 180
                          , r = a * Math.cos(o)
                          , l = a * Math.sin(o)
                          , s = r + a * (Math.random() - .5) * n
                          , d = l + a * (Math.random() - .5) * n;
                        M["p" + i] = {
                            x: r,
                            y: l
                        },
                        gsap.to(M["p" + i], .6, {
                            x: s,
                            y: d
                        })
                    }
                    M.progress = 0,
                    gsap.to(M, .8, {
                        progress: 1,
                        onUpdate: h,
                        onComplete: c
                    })
                }()
            }
            ;
            var e, f, u, v, p, y = n, w = new PIXI.Graphics;
            y.addChild(w);
            var M = {}
        }
          , t = function(n, a) {
            var f = function(n) {
                function i() {
                    v.clear(),
                    v.lineStyle(d, h),
                    v.moveTo(s.x, s.y),
                    0 == u ? v.lineTo(r.x, r.y) : v.lineTo(l.x, l.y)
                }
                function o() {
                    0 == u ? (u = 1,
                    s = {
                        x: r.x,
                        y: r.y
                    },
                    gsap.to(s, f, {
                        x: l.x,
                        y: l.y,
                        ease: Power1.easeOut,
                        onUpdate: i,
                        onComplete: o
                    })) : (v.clear(),
                    v.visible = false)
                }
                this.play = function(n, a, e, t) {
                    return v.visible = true,
                    u = 0,
                    r = n,
                    l = a,
                    d = e,
                    h = t,
                    c = .2 * Math.random() + .2,
                    f = .2 * Math.random() + .2,
                    s = {
                        x: r.x,
                        y: r.y
                    },
                    gsap.to(s, c, {
                        x: l.x,
                        y: l.y,
                        ease: Power1.easeOut,
                        onUpdate: i,
                        onComplete: o
                    }),
                    c + f
                }
                ;
                var r, l, s, d, h, c, f, u, a = n, v = new PIXI.Graphics;
                a.addChild(v)
            };
            function u() {
                y.visible = false,
                0 <= v.id && C[v.id].push(v),
                e && e()
            }
            this.play = function(n) {
                e = n,
                function() {
                    p.setChildIndex(y, p.children.length - 1),
                    y.visible = true,
                    y.x = windowWidth / 2,
                    y.y = windowHeight / 2,
                    y.rotation = .5 * Math.PI * Math.floor(4 * Math.random());
                    for (var n, a = Math.floor(7 * Math.random() + 2), e = .8 * Math.min(windowWidth, windowHeight), t = (v.size = e) / a * (.4 * Math.random() + .7), i = e / a * (.4 * Math.random() + .1), o = getRandomColor(), r = 0, l = 0; l <= a; l++) {
                        var s = (l - .5 * a) * t
                          , d = {
                            x: -e / 2,
                            y: s
                        }
                          , h = {
                            x: e / 2,
                            y: s
                        }
                          , c = (n = w[l] ? w[l] : new f(y)).play(d, h, i, o);
                        r < c && (r = c),
                        w[l] = n
                    }
                    gsap.delayedCall(r, u)
                }()
            }
            ;
            var v = this
              , p = n;
            this.id = a;
            var e, y = new PIXI.Container, w = [];
            this.size = 0,
            this.container = y,
            p.addChild(y)
        };
        function l(n, a) {
            for (var e = M.length, t = 0; t < e; t++) {
                var i = M[t];
                if (i.hitcheck(n, a))
                    return u != i.id && i.play(),
                    i.id
            }
            return false
        }
        function onKeyDown(n) {
            var index = n.keyCode;
            if (65 <= n.keyCode) index = n.keyCode - 55;
            else if (48 <= n.keyCode) index = n.keyCode - 48;
            clickLaunchPad(index)
        }
        function onKeyUp(n) {
            clickLaunchPad(-1)
        }
        function onMouseDown(n) {
            mouseDownFlag = true;
            var a = aidn.event.getPos(n), e = l(a.x, a.y);
            if (clickLaunchPad(e), n.originalEvent && n.originalEvent.touches) {
                var t = n.originalEvent.touches.length;
                for (var i = 1; i < t; i++) {
                    var o = n.originalEvent.touches[i];
                    e = l(o.pageX, o.pageY);
                    clickLaunchPad(e, 1);
                }
            }
        }
        function onMouseMove(n) {
            if (mouseDownFlag) {
                var a = aidn.event.getPos(n);
                clickLaunchPad(l(a.x, a.y), 0)
            }
            n.preventDefault()
        }
        function onMouseUp(n) {
            if (mouseDownFlag) {
                clickLaunchPad(-1);
                mouseDownFlag = false;
            }
        }
        function clickLaunchPad(index, a) {
            var t, i;
            if (u != index) {
                if (a != 1) u = index;
                if (u >= 0) {
                    vocalPlayer.play(index % vocalPlayer.length);
                    // 模式二：像素首页演奏反馈（涟漪 + 人物跳舞 + 飞鸟惊起）
                    // 挂在此处是因为 clickLaunchPad 是键鼠共用的唯一分发点，
                    // 不会重复处理同一次按键。
                    if (window.PixelHome) window.PixelHome.pulse(index);
                    D = 90;
                    if (isUserIdle) {
                        isUserIdle = false;
                        $("#bt_back").stop().fadeOut(200, "linear");
                        if (enableFullscreen) $("#bt_fs").stop().fadeOut(200, "linear");
                        $("#scene_main .set").stop().fadeOut(200, "linear");
                    }
                    if (--x <= 0) {
                        i = (t = Math.floor(I.length * Math.random())) + m.length;
                        (C[i].length ? C[i].pop() : new I[t](b,i)).play();
                        x = 12 * Math.random() + 6;
                    }
                    t = index % m.length;
                    (0 < C[t].length ? C[t].pop() : new m[t](b,t)).play();
                }
            }
        }
        this.resize = function() {
            if (w) {
                var n = 0
                  , a = v
                  , e = p;
                windowHeight < windowWidth && (a = p,
                e = v);
                for (var t = windowWidth / a, i = windowHeight / e, o = 0; o < e; o++)
                    for (var r = 0; r < a; r++) {
                        var l;
                        M[n] ? l = M[n] : (l = new s(n,f),
                        M[n] = l),
                        l.setPosition(t * r, i * o),
                        l.setSize(t, i),
                        n++
                    }
                T.resize()
            }
        }
        this.init = function() {
            w = true;
            b = new PIXI.Container;
            renderContainer.addChild(b);
            f = new PIXI.Container;
            renderContainer.addChild(f);
            T = new n(b);
            T.setColor(0x88CCCC, 0);
        }
        this.start = function() {
            if (!isMobile) {
                $("#view").on("mousedown", onMouseDown);
                $(window).on("mousemove", onMouseMove);
                $(window).on("mouseup", onMouseUp);
                $(window).on("keydown", onKeyDown);
                $(window).on("keyup", onKeyUp);
            }
            else if (window.TouchEvent) {
                $("#view").on("touchstart", onMouseDown);
                $(window).on("touchmove", onMouseMove);
                $(window).on("touchend", onMouseUp);
            }
            $("#view").css("cursor", "pointer");
        }
        this.end = function() {
            if (!isMobile) {
                $("#view").off("mousedown", onMouseDown);
                $(window).off("mousemove", onMouseMove);
                $(window).off("mouseup", onMouseUp);
                $(window).off("keydown", onKeyDown);
                $(window).off("keyup", onKeyUp);
            }
            else if (window.TouchEvent) {
                $("#view").off("touchstart", onMouseDown);
                $(window).off("touchmove", onMouseMove);
                $(window).off("touchend", onMouseUp);
            }
            $("#view").css("cursor", "auto");
        }
        this.changeId = function(n, a, e) {
            clickLaunchPad(n, a, e)
        }
        var f, u = -1, v = 4, p = 8, mouseDownFlag = false, w = false, M = [], m = [function(n, a) {
            var s = function(n) {
                function l() {
                    s.visible = false
                }
                this.play = function(n, a, e) {
                    s.visible = true,
                    s.clear();
                    var t = windowWidth * Math.random()
                      , i = windowHeight * Math.random()
                      , o = Math.min(windowWidth, windowHeight) * (.03 * Math.random() + .02);
                    s.lineStyle(3 * Math.random() + 3, e),
                    s.drawCircle(0, 0, o),
                    s.x = n,
                    s.y = a,
                    s.scale.x = 0,
                    s.scale.y = 0,
                    s.rotation = Math.random() * Math.PI;
                    var r = .2 * Math.random() + .4;
                    return gsap.to(s, r, {
                        x: t,
                        y: i,
                        rotation: Math.random() * Math.PI,
                        ease: Power3.easeOut,
                        onComplete: l
                    }),
                    gsap.to(s.scale, r, {
                        x: 1,
                        y: 1,
                        ease: Back.easeOut.config(1.7)
                    }),
                    r
                }
                ;
                var a = n
                  , s = new PIXI.Graphics;
                a.addChild(s)
            };
            function d() {
                f.visible = false,
                C[e.id].push(e)
            }
            this.play = function() {
                !function() {
                    h.setChildIndex(f, h.children.length - 1),
                    f.visible = true;
                    for (var n = 5 * Math.random() + 7, a = 0, e = windowWidth / 2, t = windowHeight / 2, i = getRandomColor(), o = 0; o < n; o++) {
                        var r;
                        r = c[o] ? c[o] : new s(f);
                        var l = (c[o] = r).play(e, t, i);
                        a < l && (a = l)
                    }
                    gsap.delayedCall(a, d)
                }()
            }
            ;
            var e = this
              , h = n;
            this.id = a;
            var c = []
              , f = new PIXI.Container;
            h.addChild(f)
        }
        , function(n, a) {
            var s = function(n) {
                function l() {
                    s.visible = false
                }
                this.play = function(n, a, e) {
                    s.visible = true,
                    s.clear();
                    var t = windowWidth * Math.random()
                      , i = windowHeight * Math.random()
                      , o = Math.min(windowWidth, windowHeight) * (.04 * Math.random() + .02);
                    s.beginFill(e),
                    s.drawRect(-o / 2, -o / 2, o, o),
                    s.x = n,
                    s.y = a,
                    s.scale.x = 0,
                    s.scale.y = 0,
                    s.rotation = Math.random() * Math.PI;
                    var r = .2 * Math.random() + .4;
                    return gsap.to(s, r, {
                        x: t,
                        y: i,
                        rotation: Math.random() * Math.PI,
                        ease: Power3.easeOut,
                        onComplete: l
                    }),
                    gsap.to(s.scale, r, {
                        x: 1,
                        y: 1,
                        ease: Back.easeOut.config(1.7)
                    }),
                    r
                }
                ;
                var a = n
                  , s = new PIXI.Graphics;
                a.addChild(s)
            };
            function d() {
                f.visible = false,
                C[e.id].push(e)
            }
            this.play = function() {
                !function() {
                    h.setChildIndex(f, h.children.length - 1),
                    f.visible = true;
                    for (var n = 5 * Math.random() + 7, a = 0, e = windowWidth / 2, t = windowHeight / 2, i = getRandomColor(), o = 0; o < n; o++) {
                        var r;
                        r = c[o] ? c[o] : new s(f);
                        var l = (c[o] = r).play(e, t, i);
                        a < l && (a = l)
                    }
                    gsap.delayedCall(a, d)
                }()
            }
            ;
            var e = this
              , h = n;
            this.id = a;
            var c = []
              , f = new PIXI.Container;
            h.addChild(f)
        }
        , function(n, a) {
            var h = function(n) {
                function r() {
                    h.beginFill(l),
                    h.drawCircle(0, 0, s),
                    h.scale.x = 0,
                    h.scale.y = 0,
                    gsap.to(h.scale, .7, {
                        x: 1,
                        y: 1,
                        ease: Elastic.easeOut.config(1, .3),
                        onComplete: a
                    })
                }
                function a() {
                    gsap.to(h.scale, .4, {
                        x: 0,
                        y: 0,
                        ease: Power2.easeOut,
                        onComplete: e,
                        delay: .1
                    })
                }
                function e() {
                    h.visible = false,
                    d && d()
                }
                this.play = function(n, a, e, t, i, o) {
                    h.visible = true,
                    h.clear(),
                    h.x = t,
                    h.y = i,
                    l = a,
                    s = e,
                    d = o,
                    gsap.delayedCall(n, r)
                }
                ;
                var l, s, d, t = n, h = new PIXI.Graphics;
                t.addChild(h)
            };
            function c() {
                v.visible = false,
                C[e.id].push(e)
            }
            this.play = function() {
                !function() {
                    f.setChildIndex(v, f.children.length - 1),
                    v.visible = true,
                    v.x = windowWidth / 2,
                    v.y = windowHeight / 2,
                    v.rotation = Math.random() * Math.PI * 2;
                    for (var n = 10, a = getRandomColor(), e = Math.min(windowWidth, windowHeight) / 64 * (.6 * Math.random() + .7), t = 2, i = 0; i < 40; i++) {
                        var o, r = 25 * i * Math.PI / 180, l = n * Math.cos(r), s = n * Math.sin(r);
                        n += e,
                        t += .22,
                        o = u[i] ? u[i] : new h(v),
                        u[i] = o;
                        var d = null;
                        39 == i && (d = c),
                        o.play(.03 * i, a, t, l, s, d)
                    }
                }()
            }
            ;
            var e = this
              , f = n;
            this.id = a;
            var u = []
              , v = new PIXI.Container;
            f.addChild(v)
        }
        , function(n, a) {
            function e() {
                C[t.id].push(t)
            }
            this.play = function() {
                o.play(0, e)
            }
            ;
            var t = this
              , i = n
              // 显式声明 _state：原压缩代码里它是隐式全局变量，
              // 在 module 作用域（严格模式）下会抛 ReferenceError。
              , _state = 0;
            this.id = a;
            var o = new r(i)
        }
        , function(n, a) {
            function e() {
                C[t.id].push(t)
            }
            this.play = function() {
                o.play(1, e)
            }
            ;
            var t = this
              , i = n;
            this.id = a;
            var o = new r(i)
        }
        , function(n, a) {
            function h() {
                f.visible = false,
                C[e.id].push(e)
            }
            this.play = function() {
                !function() {
                    c.setChildIndex(f, c.children.length - 1),
                    f.visible = true,
                    f.x = windowWidth / 2,
                    f.y = windowHeight / 2;
                    var n = getRandomColor()
                      , a = Math.min(windowWidth, windowHeight) * (.28 * Math.random() + .2)
                      , e = Math.floor(5 * Math.random()) + 3;
                    u.clear(),
                    u.lineStyle(7 * Math.random() + 4, n, 1),
                    u.rotation = 30 * Math.floor(6 * Math.random());
                    for (var t = 360 / e, i = 0; i <= e; i++) {
                        var o = i * t * Math.PI / 180
                          , r = a * Math.cos(o)
                          , l = a * Math.sin(o);
                        0 == i ? u.moveTo(r, l) : u.lineTo(r, l)
                    }
                    var s = .8 * Math.random() + .4
                      , d = .8 * Math.random() + .4;
                    gsap.fromTo(u.scale, .9, {
                        x: s,
                        y: s
                    }, {
                        x: d,
                        y: d,
                        ease: Bounce.easeOut
                    }),
                    v.play(a, h)
                }()
            }
            ;
            var e = this
              , c = n;
            this.id = a;
            var f = new PIXI.Container
              , u = new PIXI.Graphics;
            c.addChild(f),
            f.addChild(u);
            var v = new d(f,u)
        }
        , function(n, a) {
            var i = function(n) {
                function e() {
                    var n = Math.min(windowWidth, windowHeight)
                      , a = n * (.08 * Math.random() + .05);
                    l.lineStyle(4 * Math.random() + 4, getRandomColor()),
                    l.drawRect(-a / 2, -a / 2, a, a),
                    l.x = o + n / 2 * (Math.random() - .5),
                    l.y = r + n / 2 * (Math.random() - .5),
                    l.scale.x = 0,
                    l.scale.y = 0,
                    l.rotation = Math.random() * Math.PI,
                    gsap.to(l, .5, {
                        x: o,
                        y: r,
                        rotation: 0,
                        ease: Back.easeOut.config(1.7),
                        onComplete: t
                    }),
                    gsap.to(l.scale, .5, {
                        x: 1,
                        y: 1,
                        ease: Back.easeOut.config(1.7)
                    })
                }
                function t() {
                    var n = Math.min(windowWidth, windowHeight)
                      , a = o + n / 2 * (Math.random() - .5)
                      , e = r + n / 2 * (Math.random() - .5);
                    gsap.to(l, .5, {
                        x: a,
                        y: e,
                        rotation: -Math.random() * Math.PI,
                        ease: Back.easeIn.config(1.7),
                        onComplete: i,
                        delay: .2
                    }),
                    gsap.to(l.scale, .5, {
                        x: 0,
                        y: 0,
                        ease: Back.easeIn.config(1.7),
                        delay: .2
                    })
                }
                function i() {
                    l.visible = false
                }
                this.play = function(n, a) {
                    l.visible = true,
                    l.clear(),
                    o = windowWidth * Math.random(),
                    r = windowHeight * Math.random(),
                    gsap.delayedCall(n, e)
                }
                ;
                var o, r, a = n, l = new PIXI.Graphics;
                a.addChild(l)
            };
            function o() {
                l.visible = false,
                C[e.id].push(e)
            }
            this.play = function() {
                !function() {
                    r.setChildIndex(l, r.children.length - 1),
                    l.visible = true;
                    for (var n = Math.floor(5 * Math.random() + 5), a = 0; a < n; a++) {
                        var e;
                        e = s[a] ? s[a] : new i(l),
                        s[a] = e;
                        var t = null;
                        a == n - 1 && (t = o),
                        e.play(.06 * a, t)
                    }
                }()
            }
            ;
            var e = this
              , r = n;
            this.id = a;
            var l = new PIXI.Container;
            r.addChild(l);
            var s = []
        }
        , function(n, a) {
            var i = function(n) {
                function e() {
                    var n = Math.min(windowWidth, windowHeight) * (.05 * Math.random() + .014);
                    l.beginFill(getRandomColor()),
                    l.drawCircle(0, 0, n),
                    l.x = i,
                    l.y = o,
                    l.scale.x = 0,
                    l.scale.y = 0,
                    gsap.to(l.scale, .5, {
                        x: 1,
                        y: 1,
                        ease: Elastic.easeOut.config(1, .3),
                        onComplete: a
                    })
                }
                function a() {
                    gsap.to(l.scale, .5, {
                        x: 0,
                        y: 0,
                        ease: Back.easeIn.config(1.7),
                        onComplete: t,
                        delay: .2
                    })
                }
                function t() {
                    l.visible = false
                }
                this.play = function(n, a) {
                    l.visible = true,
                    l.clear(),
                    i = windowWidth * Math.random(),
                    o = windowHeight * Math.random(),
                    gsap.delayedCall(n, e)
                }
                ;
                var i, o, r = n, l = new PIXI.Graphics;
                r.addChild(l)
            };
            function o() {
                l.visible = false,
                C[e.id].push(e)
            }
            this.play = function() {
                !function() {
                    r.setChildIndex(l, r.children.length - 1),
                    l.visible = true;
                    for (var n = Math.floor(5 * Math.random() + 5), a = 0; a < n; a++) {
                        var e;
                        e = s[a] ? s[a] : new i(l),
                        s[a] = e;
                        var t = null;
                        a == n - 1 && (t = o),
                        e.play(.06 * a, t)
                    }
                }()
            }
            ;
            var e = this
              , r = n;
            this.id = a;
            var l = new PIXI.Container;
            r.addChild(l);
            var s = []
        }
        , function(n, a) {
            function o() {
                l.visible = false,
                C[e.id].push(e)
            }
            this.play = function() {
                !function() {
                    l.visible = true,
                    r.setChildIndex(l, r.children.length - 1),
                    d.container.mask = s,
                    d.play(o);
                    var n = d.size / 2;
                    s.x = windowWidth / 2,
                    s.y = windowHeight / 2,
                    s.clear(),
                    s.beginFill(0),
                    s.drawCircle(0, 0, n);
                    var a = 45 * Math.PI / 180 * Math.floor(2 * Math.random())
                      , e = a + 45 * Math.PI / 180 * Math.floor(4 * Math.random() - 2)
                      , t = .3 * Math.random() + 1
                      , i = .3 * -Math.random() + 1;
                    gsap.fromTo(d.container, .6, {
                        rotation: a
                    }, {
                        rotation: e,
                        ease: Power2.easeOut
                    }),
                    gsap.fromTo(d.container.scale, .6, {
                        x: t,
                        y: t
                    }, {
                        x: i,
                        y: i,
                        ease: Back.easeOut.config(1.7)
                    }),
                    gsap.fromTo(s.scale, .6, {
                        x: t,
                        y: t
                    }, {
                        x: i,
                        y: i,
                        ease: Back.easeOut.config(1.7)
                    })
                }()
            }
            ;
            var e = this
              , r = n;
            this.id = a;
            var l = new PIXI.Container;
            r.addChild(l);
            var s = new PIXI.Graphics;
            l.addChild(s);
            var d = new t(l,-1)
        }
        , function(n, a) {
            function d() {
                c.visible = false,
                C[e.id].push(e)
            }
            this.play = function() {
                !function() {
                    h.setChildIndex(c, h.children.length - 1),
                    c.clear(),
                    c.visible = true,
                    c.lineStyle(5 * Math.random() + 3, getRandomColor(), 1),
                    c.x = windowWidth / 2,
                    c.y = windowHeight / 2;
                    for (var n = .6 * Math.min(windowWidth, windowHeight), a = Math.floor(5 * Math.random()) + 3, e = 360 / a, t = .5 * Math.max(windowWidth, windowHeight) / n * (1.6 + .6 / a), i = 0; i <= a; i++) {
                        var o = i * e * Math.PI / 180
                          , r = n * Math.cos(o)
                          , l = n * Math.sin(o);
                        0 == i ? c.moveTo(r, l) : c.lineTo(r, l)
                    }
                    var s = .3 * Math.random() + .6;
                    gsap.fromTo(c.scale, s, {
                        x: 0,
                        y: 0
                    }, {
                        x: t,
                        y: t,
                        onComplete: d,
                        ease: Power2.easeOut
                    }),
                    gsap.fromTo(c, s, {
                        rotation: Math.random() * Math.PI
                    }, {
                        rotation: Math.random() * Math.PI,
                        ease: Power1.easeOut
                    })
                }()
            }
            ;
            var e = this
              , h = n;
            this.id = a;
            var c = new PIXI.Graphics;
            h.addChild(c)
        }
        , function(n, a) {
            function e() {
                o.visible = false,
                C[t.id].push(t)
            }
            this.play = function() {
                !function() {
                    i.setChildIndex(o, i.children.length - 1),
                    o.visible = true,
                    o.x = windowWidth / 2,
                    o.y = windowHeight / 2;
                    var n = getRandomColor()
                      , a = Math.min(windowWidth, windowHeight) * (.25 * Math.random() + .1);
                    r.clear(),
                    r.beginFill(n),
                    r.drawCircle(0, 0, a),
                    l.play(a, e)
                }()
            }
            ;
            var t = this
              , i = n;
            this.id = a;
            var o = new PIXI.Container
              , r = new PIXI.Graphics;
            i.addChild(o),
            o.addChild(r);
            var l = new d(o,r)
        }
        , function(n, a) {
            var u = function(n) {
                function t() {
                    gsap.to(l.scale, .4, {
                        x: 0,
                        y: 0,
                        ease: Back.easeIn.config(2),
                        onComplete: a,
                        delay: .7
                    }),
                    gsap.to(l, .4, {
                        rotation: Math.random() * Math.PI * 2,
                        ease: Back.easeIn.config(2),
                        delay: .7
                    })
                }
                function a() {
                    l.visibloe = false,
                    i && i()
                }
                this.init = function(n, a, e, t) {
                    _state = 0,
                    o = e,
                    r = t,
                    l.x = n,
                    l.y = a
                }
                ,
                this.play = function(n, a) {
                    i = a,
                    l.clear(),
                    l.visibloe = true,
                    l.beginFill(r),
                    l.drawRect(.5 * -o, .5 * -o, o, o),
                    gsap.fromTo(l.scale, .3, {
                        x: 0,
                        y: 0
                    }, {
                        x: 1,
                        y: 1,
                        ease: Back.easeOut.config(1.7),
                        onComplete: t,
                        delay: n
                    }),
                    gsap.fromTo(l, .7, {
                        rotation: Math.random() * Math.PI * 2
                    }, {
                        rotation: 0,
                        ease: Elastic.easeOut.config(1, .3),
                        delay: n
                    });
                    var e = Math.random() * Math.PI;
                    gsap.fromTo(y, 1, {
                        rotation: 0
                    }, {
                        rotation: e,
                        ease: Bounce.easeOut,
                        delay: n
                    })
                }
                ;
                var i, o, r, e = n, l = new PIXI.Graphics;
                e.addChild(l)
            };
            function v() {
                y.visible = false,
                C[e.id].push(e)
            }
            this.play = function() {
                !function() {
                    p.setChildIndex(y, p.children.length - 1),
                    y.visible = true,
                    y.x = windowWidth / 2,
                    y.y = windowHeight / 2;
                    var n = Math.floor(8 * Math.random() + 6)
                      , a = Math.min(windowWidth, windowHeight) * (.25 * Math.random() + .25)
                      , e = 360 / n
                      , t = a * (.15 * Math.random() + .05)
                      , i = getRandomColor()
                      , o = Math.PI / 2 * Math.floor(4 * Math.random())
                      , r = 1;
                    Math.random() < .5 && (r = -1);
                    for (var l = 0; l < n; l++) {
                        var s, d = (r * e * l + o) * Math.PI / 180, h = a * Math.cos(d), c = a * Math.sin(d);
                        s = w[l] ? w[l] : new u(y),
                        w[l] = s;
                        var f = null;
                        l == n - 1 && (f = v),
                        s.init(h, c, t, i),
                        s.play(.05 * l, f)
                    }
                }()
            }
            ;
            var e = this
              , p = n
              // 同上：显式声明，避免严格模式下 ReferenceError
              , _state = 0;
            this.id = a;
            var y = new PIXI.Container
              , w = [];
            p.addChild(y)
        }
        , function(n, a) {
            var u = function(n) {
                function e() {
                    var n = .5 * windowWidth
                      , a = l.x + Math.random() * n - n / 2
                      , e = l.y + Math.random() * n - n / 2;
                    gsap.to(l.scale, .3, {
                        x: 0,
                        y: 0,
                        ease: Power1.easeOut,
                        onComplete: t,
                        delay: .5
                    }),
                    gsap.to(l, .3, {
                        x: a,
                        y: e,
                        ease: Power2.easeOut,
                        delay: .5
                    })
                }
                function t() {
                    l.visibloe = false,
                    i && i()
                }
                this.init = function(n, a, e, t) {
                    _state = 0,
                    o = e,
                    r = t,
                    l.x = n,
                    l.y = a
                }
                ,
                this.play = function(n, a) {
                    i = a,
                    l.clear(),
                    l.visibloe = true,
                    l.beginFill(r),
                    l.drawCircle(0, 0, .5 * o),
                    gsap.fromTo(l.scale, .3, {
                        x: 0,
                        y: 0
                    }, {
                        x: 1,
                        y: 1,
                        ease: Back.easeOut.config(1.7),
                        onComplete: e,
                        delay: n
                    })
                }
                ;
                var i, o, r, a = n, l = new PIXI.Graphics;
                a.addChild(l)
            };
            function v() {
                y.visible = false,
                C[e.id].push(e)
            }
            this.play = function() {
                !function() {
                    p.setChildIndex(y, p.children.length - 1),
                    y.visible = true,
                    y.x = windowWidth / 2,
                    y.y = windowHeight / 2;
                    var n = Math.floor(8 * Math.random() + 6)
                      , a = Math.min(windowWidth, windowHeight) * (.2 * Math.random() + .25)
                      , e = 360 / n
                      , t = a * (.2 * Math.random() + .05)
                      , i = getRandomColor()
                      , o = Math.PI / 2 * Math.floor(4 * Math.random())
                      , r = 1;
                    Math.random() < .5 && (r = -1);
                    for (var l = 0; l < n; l++) {
                        var s, d = (r * e * l + o) * Math.PI / 180, h = a * Math.cos(d), c = a * Math.sin(d);
                        s = w[l] ? w[l] : new u(y),
                        w[l] = s;
                        var f = null;
                        l == n - 1 && (f = v),
                        s.init(h, c, t, i),
                        s.play(.05 * l, f)
                    }
                }()
            }
            ;
            var e = this
              , p = n;
            this.id = a;
            var y = new PIXI.Container
              , w = [];
            p.addChild(y)
        }
        , function(n, a) {
            function i() {
                r.visible = false,
                C[e.id].push(e)
            }
            this.play = function() {
                !function() {
                    r.visible = true,
                    o.setChildIndex(r, o.children.length - 1),
                    r.x = .2 * windowWidth + .6 * windowWidth * Math.random(),
                    r.y = .2 * windowHeight + .6 * windowHeight * Math.random();
                    var n, a = Math.min(windowWidth, windowHeight) * (.7 + .2 * Math.random()), e = a / 10 * (.5 + .8 * Math.random()), t = getRandomColor();
                    l.clear(),
                    l.beginFill(t),
                    l.drawRect(0, -e / 2, a, e),
                    s.clear(),
                    s.beginFill(t),
                    s.drawRect(-e / 2, 0, e, a),
                    l.y = 0,
                    l.x = -a / 2,
                    s.x = 0,
                    s.y = -a / 2,
                    r.rotation = 45 * Math.PI / 180,
                    l.scale.x = 0,
                    s.scale.y = 0,
                    n = Math.random() < .5 ? -135 * Math.PI / 180 : 215 * Math.PI / 180,
                    (new TimelineLite).to(l.scale, .4, {
                        x: 1,
                        ease: Power2.easeOut
                    }).to(s.scale, .4, {
                        y: 1,
                        ease: Power2.easeOut
                    }, .1).to(r, .6, {
                        rotation: n,
                        ease: Back.easeOut.config(1.7)
                    }, 0).to(l.scale, .3, {
                        x: 0,
                        ease: Power2.easeOut
                    }).to(s.scale, .3, {
                        y: 0,
                        ease: Power2.easeOut,
                        onComplete: i
                    }, .6)
                }()
            }
            ;
            var e = this
              , o = n;
            this.id = a;
            var r = new PIXI.Container
              , l = new PIXI.Graphics
              , s = new PIXI.Graphics;
            o.addChild(r),
            r.addChild(l),
            r.addChild(s)
        }
        , function(n, a) {
            function o() {
                if (r < ++c)
                    switch (l) {
                    case 0:
                        l = 1;
                        var n = h[0];
                        f.x = n.x,
                        f.y = n.y,
                        c = 0,
                        o();
                        break;
                    case 1:
                        l = 2
                    }
                else
                    gsap.to(f, .1, {
                        x: h[c].x,
                        y: h[c].y,
                        onComplete: o,
                        onUpdate: e,
                        ease: Power1.easeOut
                    })
            }
            function e() {
                switch (u.clear(),
                u.lineStyle(s, d, 1),
                l) {
                case 0:
                    u.moveTo(h[0].x, h[0].y);
                    for (var n = 1; n < c; n++)
                        u.lineTo(h[n].x, h[n].y);
                    u.lineTo(f.x, f.y);
                    break;
                case 1:
                    for (u.moveTo(f.x, f.y),
                    n = c; n <= r; n++)
                        u.lineTo(h[n].x, h[n].y)
                }
            }
            this.play = function() {
                !function() {
                    u.clear(),
                    u.visible = true,
                    Math.random() < .5 ? (u.x = 0,
                    u.y = 0,
                    u.rotation = 0) : (u.x = windowWidth,
                    u.y = windowHeight,
                    u.rotation = Math.PI),
                    c = l = 0,
                    r = Math.floor(3 * Math.random()) + 3,
                    s = 20 * Math.random() + 2,
                    d = getRandomColor();
                    var n, a = Math.random() < .5;
                    n = a ? windowWidth / r : windowHeight / r;
                    for (var e = 0; e <= r; e++) {
                        var t;
                        a ? (t = {
                            x: e * n,
                            y: windowHeight * Math.random()
                        },
                        0 == e && (t.x -= 10),
                        e == r && (t.x += 10)) : (t = {
                            y: e * n,
                            x: windowWidth * Math.random()
                        },
                        0 == e && (t.y -= 10),
                        e == r && (t.y += 10)),
                        h[e] = t
                    }
                    var i = h[0];
                    f.x = i.x,
                    f.y = i.y,
                    o()
                }()
            }
            ;
            var t = n;
            this.id = a;
            var r, l, s, d, h = [], c = 0, f = {
                x: 0,
                y: 0
            }, u = new PIXI.Graphics;
            t.addChild(u)
        }
        , t], I = [function(n, a) {
            function d() {
                y.clear(),
                y.beginFill(c),
                y.moveTo(u.pos.b1.x, u.pos.b1.y),
                y.lineTo(u.pos.b0.x, u.pos.b0.y);
                for (var n = 0; u.pos["p" + n]; n++) {
                    var a = u.pos["p" + n];
                    y.lineTo(a.x, a.y)
                }
                y.endFill()
            }
            function h() {
                F == w && T.setColor(c, p - 1),
                y.visible = false,
                C[u.id].push(u)
            }
            this.play = function() {
                !function() {
                    F = w;
                    var n = randomColorIndex();
                    c = colorMap[n],
                    $("#about").css("background-color", "#" + c.toString(16)),
                    $("#select").css("background-color", "#" + c.toString(16)),
                    Math.random() < .3 && T.flash(p),
                    lastColorIndex = n,
                    y.clear(),
                    y.visible = true,
                    p = v.children.length - 1 - Math.floor(2 * Math.random()),
                    v.setChildIndex(y, p);
                    var a = Math.random() < .5
                      , e = Math.floor(4 * Math.random()) + 1;
                    u.pos = {};
                    var t = 0;
                    a ? (t = windowHeight / e,
                    u.pos.b0 = {
                        x: 0,
                        y: 0
                    },
                    u.pos.b1 = {
                        x: 0,
                        y: windowHeight
                    }) : (t = windowWidth / e,
                    u.pos.b0 = {
                        x: 0,
                        y: 0
                    },
                    u.pos.b1 = {
                        x: windowWidth,
                        y: 0
                    }),
                    Math.random() < .5 ? (y.rotation = 0,
                    y.x = 0,
                    y.y = 0) : (y.rotation = Math.PI,
                    y.x = windowWidth,
                    y.y = windowHeight);
                    for (var i = f = 0; i <= e; i++) {
                        var o = {
                            x: 0,
                            y: 0
                        }
                          , r = 0;
                        0 != i && i != e && (r = t / 4 * Math.random() - t / 8),
                        a ? o.y = t * i + r : o.x = t * i + r,
                        u.pos["p" + i] = o;
                        var l, s = .4 * Math.random() + .3;
                        f = 2,
                        l = a ? {
                            x: windowWidth
                        } : {
                            y: windowHeight
                        },
                        gsap.to(u.pos["p" + i], s, l)
                    }
                    u.progress = 0,
                    gsap.to(u, f, {
                        progress: 1,
                        ease: Power0.easeNone,
                        onUpdate: d,
                        onComplete: h
                    })
                }()
            }
            ;
            var c, f, u = this, v = n;
            this.id = a,
            this.progress = 0,
            this.pos = {};
            var p = 0
              , y = new PIXI.Graphics;
            v.addChild(y);
            var w = Math.floor(aidn.util.getTime())
        }
        ];
        var T, b, x = 16 * Math.random(), C = [],
            lastColorIndex = 0;
        aidn.util.shuffleArray(m);
        for (var g = 0; g < m.length + I.length; g++)
            C[g] = [];
        function getRandomColor() {
            if (!overrideColor) {
                var n = Math.random();
                if (n < 0.03) return 0x444444;
                if (n < 0.18) return 0xFFFFFF;
            }
            return colorMap[randomColorIndex()];
        }
        function randomColorIndex() {
            for (var n = 0; n < 10; n++) {
                var index = Math.floor(colorMap.length * Math.random());
                if (2 < Math.abs(lastColorIndex - index))
                    break
            }
            return index
        }
        var F = 0
    };
    var isUserIdle = false, D = 0;
    var settingsFeedback = "off" == aidn.util.getCookie("fb");
    var settingsBackgroundTrack = "off" == aidn.util.getCookie("bt");
    onFeedbackClick();
    onBgMusicClick();
    if (aidn.util.webaudio) {
        $("#ng").css("display", "none");
        $(".ok").css("display", "block");
        if (isMobile) $("#scene_main .attention").html("点按 &amp; 划动!");
    } else {
        $("#ng").css("display", "block");
        $(".ok").css("display", "none");
    }
    PIXI.utils._saidHello = true;
    aidn.window.resize(onWindowResize);

    /* =======================================================
       模式二：像素首页挂载
       ------------------------------------------------------------
       做法：
         1) 在首屏盖一层像素车站 canvas 作为背景（z-index:200）；
         2) 原首页的 4 个真实按钮（bt_start / bt_select / bt_custom / bt_about）
            **不隐藏**，而是抬高 z-index 浮在像素场景之上继续可用；
         3) 点「开始」时移除浮层规则并执行原加载链。
       关键修正：早期版本用 display:none 把 scene_top 整个藏掉，
       等于把原首页入口全部丢掉；改为「浮在场景之上」才是移植。
       ======================================================= */
    if (window.PixelHome) {
        // 像素首页浮层规则（单一定义源，三处使用：初次挂载 / 返回首页 / 入口跳转）
        // 关键：像素 canvas 必须让出 pointer-events。
        // 它是整块 fixed 覆盖层，若保留 pointer-events 会拦截所有点击，
        // 导致浮在上面的真实按钮点不动（浏览器报 "div#pixelHome intercepts pointer events"）。
        // 场景本身不需要点击（hover 效果走 mousemove，且只用于氛围），故直接交出。
        // 按钮可点击由 z-index:300 > canvas:200 的层叠顺序自然保证。
        var PIXEL_HOME_CSS =
            "#pixelHome{pointer-events:none !important;}" +
            "#scene_top{z-index:300 !important;position:fixed !important;}";
        var applyPixelHomeLayer = function () {
            var hs = document.getElementById("pixelHomeHideTop");
            if (!hs) {
                hs = document.createElement("style");
                hs.id = "pixelHomeHideTop";
                document.head.appendChild(hs);
            }
            hs.textContent = PIXEL_HOME_CSS;
        };
        var clearPixelHomeLayer = function () {
            var hs = document.getElementById("pixelHomeHideTop");
            if (hs && hs.parentNode) hs.parentNode.removeChild(hs);
        };

        PixelHome.boot(document.body);
        applyPixelHomeLayer();
        // 首次挂载即为首页态：给「首页」导航项加 at-home（禁用态）
        // 注意：syncNavState 定义在 MainManager 内部，此处（外部）不可见，直接用 jQuery 设置。
        $("#scene_top").addClass("at-home").removeClass("is-playmode");

        // 把「开始」按钮克隆到覆盖层之外是不可行的（canvas 覆盖），
        // 因此改为：在覆盖层的开始区域点击时，直接调用原项目的开始逻辑。
        // 为此把原 #bt_start 的 click 处理提取为一个可复用的函数。
        var startProject = function () {
            if (!tracksPlayer || !vocalPlayer) {
                window.alert('还没有载入歌姬或背景音轨');
                return;
            }
            $("#scene_top").stop().fadeOut(200, "linear");
            $("#scene_loading").stop().fadeIn(200, "linear");
            if (loadFlag == 2) {
                playStart();
            } else {
                useDefaultColorMap();
                (new aidn.WebAudio).load("");
                tracksPlayer.init(loadDoneCallback, loadingCallback);
            }
            try {
                aidn.adv.hide();
            } catch (e) { /* 移动端广告可能未加载 */ }
        };

        // 像素首页点「开始」→ 覆盖层淡出完成后，启动原项目
        window.__UTATAP_ON_ENTER_PLAY__ = function () {
            // 移除浮层规则：scene_top 交回原项目的正常层级
            clearPixelHomeLayer();
            // 恢复被像素首页隐藏的浮层按钮（返回 / 全屏），
            // 否则进入演奏后左上角「＜返回」会一直缺失。
            if (PixelStage && PixelStage.restoreHostChrome) {
                PixelStage.restoreHostChrome();
            }
            $("#scene_top").stop().css("display", "block");
            startProject();
        };

        // 模式二：首屏「返回」时重新盖上像素首页。
        // 覆盖层在进入演奏时已被 destroy()，因此这里要重新 boot；
        // 同时恢复用于隐藏 #scene_top 的强制样式规则。
        var showPixelHome = function () {
            // 浮层规则：让原首页面板浮在像素场景之上
            applyPixelHomeLayer();
            // 关键：这里不要再 display:none 藏 scene_top。
            // 早期版本按钮是画在 canvas 上的，需要隐藏原面板；
            // 现已改为把原首页的真实按钮直接移植到首页上，隐藏会导致
            // 「返回首页后整个面板（含标题与四个入口）消失」。
            $("#scene_top").stop().css("display", "block");
            // 重新挂载（bootOnce 会丢弃已销毁的旧实例）
            var s = PixelHome.boot(document.body);
            // 淡入，避免"啪"地出现
            var wrap = document.getElementById('pixelHome');
            if (wrap) {
                wrap.style.transition = 'opacity 260ms linear';
                wrap.style.opacity = '0';
                void wrap.offsetWidth;      // 强制回流，确保过渡生效
                wrap.style.opacity = '1';
            }
            return s;
        };

        /**
         * 像素首页上「选择 / 自定义音频 / 关于」三个入口的实际处理。
         * 策略：不重复实现功能，而是复用原项目 DOM 按钮已绑定的 jQuery 事件，
         * 保证与原首页行为完全一致，也不会产生两套逻辑。
         * 前提：像素覆盖层需先隐藏，否则会挡住原项目的面板层。
         */
        var MODE_B_ACTION = function (act) {
            // 关掉像素首页，露出原项目 DOM
            var px = window.PixelHome.get();
            if (px && px.alive) px.destroy();
            clearPixelHomeLayer();
            $("#scene_top").stop().css("display", "block");
            if (PixelStage && PixelStage.restoreHostChrome) {
                PixelStage.restoreHostChrome();
            }

            if (act === 'custom') {
                // 跳自定义页（与原 #bt_custom 的 href="custom/" 一致）
                location.href = "custom/";
                return;
            }
            // 「选择」与「关于」直接触发原按钮的 click
            var sel = act === 'select' ? "#bt_select a" : "#bt_about a";
            var $t = $(sel);
            if ($t.length) { $t.trigger("click"); }
        };
        // 注意：main.js 是 ES module，作用域里没有 Node 的 global，统一用 window。
        window.__MODE_B_ACTION__ = MODE_B_ACTION;

        /**
         * 关闭像素首页覆盖层（点「开始」时由 #bt_start 处理器调用）。
         * 与 showPixelHome 成对：移除 DOM + 交回层级 + 恢复浮层按钮。
         */
        window.__MODE_B_CLOSE_PIXEL__ = function () {
            var px = window.PixelHome && window.PixelHome.get();
            if (px && px.alive) px.destroy();
            clearPixelHomeLayer();
            if (PixelStage && PixelStage.restoreHostChrome) {
                PixelStage.restoreHostChrome();
            }
            // 演奏态：#scene_top 只保留顶部导航栏，「首页」入口常驻可见
            $("#scene_top").addClass("is-playmode").removeClass("at-home")
                .stop().css("display", "block");
        };

        // 暴露给 E2E / 调试
        window.__MODE_B__ = {
            stage: PixelHome.get(),
            startProject: startProject,
            showPixelHome: showPixelHome,
            action: MODE_B_ACTION
        };
    }
};
// WebAudioManager 已抽取至 ./modules/audio.js（ES Module，#5 模块化）
// 模式二附加：像素首页 + 演奏互动反馈（见 home-overlay.js 与 clickLaunchPad 内挂点）
