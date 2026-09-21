(function () {
  'use strict';

  var VERSION = '3';
  var BUS = 'https://ntfy.sh';
  var JOIN_PREFIX = 'thsbuddy-join-';
  var PAIR_PREFIX = 'thsbuddy-pair-';
  var STORE_KEY = 'ths-buddy-pair-v3';
  var CODE_LENGTH = 6;
  var CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var ACK_TRIES = 14;
  var ACK_INTERVAL = 4500;

  var state = { token: '', key: '', code: '', label: 'THS Buddy' };

  function el(id) { return document.getElementById(id); }
  function text(id, value) { var node = el(id); if (node) node.textContent = value; }
  function show(id, visible) { var node = el(id); if (node) node.hidden = !visible; }
  function setStatus(message, kind) {
    var node = el('status');
    node.textContent = message;
    node.className = kind || '';
  }

  function isIOS() {
    var ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }

  function isStandalone() {
    if (window.navigator.standalone === true) return true;
    return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  }

  function hasPush() { return 'serviceWorker' in navigator && 'PushManager' in window; }

  function normalizeCode(value) {
    var code = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== CODE_LENGTH) return '';
    for (var i = 0; i < code.length; i++) {
      if (CODE_ALPHABET.indexOf(code.charAt(i)) < 0) return '';
    }
    return code;
  }

  function readUrlParams() {
    var sources = [];
    if (location.hash.length > 1) sources.push(location.hash.slice(1));
    if (location.search.length > 1) sources.push(location.search.slice(1));
    for (var i = 0; i < sources.length; i++) {
      var params = new URLSearchParams(sources[i]);
      var token = params.get('t') || '';
      var code = (params.get('c') || '').toUpperCase();
      if (token || code) {
        return { token: token, key: params.get('k') || '', code: code, label: params.get('s') || '' };
      }
    }
    return null;
  }

  function readStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) { return null; }
  }

  function writeStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (error) { /* 隐私模式下会失败 */ }
  }

  function b64urlToBytes(value) {
    var normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
    while (normalized.length % 4 !== 0) normalized += '=';
    var raw = atob(normalized);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  function topics() {
    var list = [];
    if (state.token) list.push(PAIR_PREFIX + state.token);
    if (state.code) list.push(JOIN_PREFIX + state.code);
    return list;
  }

  function publish(topic, body) {
    return fetch(BUS + '/' + topic, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: body
    }).then(function (response) { return response.ok; }).catch(function () { return false; });
  }

  function readMessages(list) {
    return fetch(BUS + '/' + list.join(',') + '/json?poll=1&since=all', {
      cache: 'no-store',
      headers: { Accept: 'application/x-ndjson' }
    }).then(function (response) {
      return response.ok ? response.text() : '';
    }).then(function (body) {
      var out = [];
      body.split('\n').forEach(function (line) {
        if (!line.trim()) return;
        try {
          var row = JSON.parse(line);
          if (row && typeof row.message === 'string') out.push(JSON.parse(row.message));
        } catch (error) { /* 忽略无关消息 */ }
      });
      return out;
    }).catch(function () { return []; });
  }

  function findHello(code) {
    return readMessages([JOIN_PREFIX + code]).then(function (list) {
      for (var i = list.length - 1; i >= 0; i--) {
        var item = list[i];
        if (item && item.kind === 'ths-buddy-hello' && typeof item.k === 'string' && item.k) {
          return { key: item.k, label: typeof item.s === 'string' ? item.s : '' };
        }
      }
      return null;
    });
  }

  function waitForAck(list, done) {
    var tries = 0;
    function step() {
      tries += 1;
      readMessages(list).then(function (messages) {
        for (var i = 0; i < messages.length; i++) {
          if (messages[i] && messages[i].kind === 'ths-buddy-ack') { done(true); return; }
        }
        if (tries >= ACK_TRIES) { done(false); return; }
        setTimeout(step, ACK_INTERVAL);
      });
    }
    step();
  }

  function ensurePermission() {
    if (typeof Notification === 'undefined') return Promise.resolve(false);
    if (Notification.permission === 'granted') return Promise.resolve(true);
    if (Notification.permission === 'denied') return Promise.resolve(false);
    return Notification.requestPermission().then(function (value) { return value === 'granted'; });
  }

  function rememberForServiceWorker(list) {
    if (!window.caches) return Promise.resolve();
    var record = JSON.stringify({ topics: list, label: state.label, savedAt: Date.now() });
    return caches.open('ths-buddy-pair').then(function (cache) {
      return cache.put('state.json', new Response(record, { headers: { 'Content-Type': 'application/json' } }));
    }).catch(function () { /* 记不住也不影响本次配对 */ });
  }

  function buildPayload(subscription) {
    var body = {
      kind: 'ths-buddy-pair',
      label: state.label || '手机',
      subscription: { endpoint: subscription.endpoint, keys: subscription.keys }
    };
    if (state.token) body.token = state.token;
    if (state.code) body.code = state.code;
    return JSON.stringify(body);
  }

  async function run() {
    var button = el('go');
    button.disabled = true;
    try {
      if (!state.code) {
        var typed = normalizeCode(el('codeInput').value);
        if (!typed) {
          setStatus('配对码不对。电脑上显示的是 6 位，只含字母和数字（没有 I、O、0、1），请再输一次。', 'warn');
          return;
        }
        state.code = typed;
        writeStore();
      }
      if (!state.key) {
        setStatus('正在向电脑索取配对密钥…', 'busy');
        var hello = await findHello(state.code);
        if (hello === null) {
          setStatus('没拿到电脑的配对密钥。请确认电脑上的二维码还在有效期内（10 分钟），再点一次。', 'warn');
          return;
        }
        state.key = hello.key;
        if (!state.label && hello.label) state.label = hello.label;
        writeStore();
      }
      setStatus('正在安装后台服务…', 'busy');
      var registration = await navigator.serviceWorker.register('sw.js?v=' + VERSION, { scope: './' });
      await navigator.serviceWorker.ready;
      setStatus('系统会问是否允许通知，请点「允许」。', 'busy');
      var granted = await ensurePermission();
      if (!granted) {
        setStatus('通知权限没有打开。请到 iPhone「设置 → 通知」里找到「THS 推送」并允许通知，然后回来重试。', 'warn');
        return;
      }
      setStatus('正在向系统申请订阅…', 'busy');
      var existing = await registration.pushManager.getSubscription();
      var subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64urlToBytes(state.key)
      });
      var payload = buildPayload(subscription.toJSON());
      el('manualText').value = payload;
      var list = topics();
      setStatus('正在把订阅回传给电脑…', 'busy');
      var results = await Promise.all(list.map(function (topic) { return publish(topic, payload); }));
      if (results.indexOf(true) < 0) {
        show('manual', true);
        setStatus('自动回传失败（网络到不了 ntfy.sh）。请复制下面的文本，发到电脑上控制台的「手动配对」。', 'warn');
        return;
      }
      await rememberForServiceWorker(list);
      show('manual', true);
      setStatus('已回传，正在等电脑确认…', 'busy');
      waitForAck(list, function (confirmed) {
        if (confirmed) {
          setStatus('配对成功。回到电脑点「发送测试推送」，这台手机马上就应该响。', 'ok');
        } else {
          setStatus('已回传，但没等到电脑确认。请回到电脑看设备列表里有没有这台手机。', 'warn');
        }
      });
    } catch (error) {
      setStatus('配对失败：' + (error && error.message ? error.message : String(error)), 'warn');
    } finally {
      button.disabled = false;
    }
  }

  function render() {
    var ios = isIOS();
    var standalone = isStandalone();
    var lines = [
      'pair.js v' + VERSION,
      'iOS: ' + (ios ? '是' : '否') + ' · 主屏幕模式: ' + (standalone ? '是' : '否'),
      'Service Worker: ' + ('serviceWorker' in navigator ? '可用' : '不可用') + ' · PushManager: ' + ('PushManager' in window ? '可用' : '不可用'),
      '通知权限: ' + (typeof Notification === 'undefined' ? '无 Notification' : Notification.permission),
      '参数: token=' + (state.token ? state.token.slice(0, 8) + '…' : '无') + ' code=' + (state.code || '无') + ' key=' + (state.key ? '有' : '无'),
      'standalone 标记: ' + String(window.navigator.standalone),
      'UA: ' + navigator.userAgent
    ];
    text('diagText', lines.join('\n'));
    show('codeBox', !state.code);
    if (!('serviceWorker' in navigator)) {
      show('go', false);
      setStatus('这个浏览器不支持 Service Worker，无法接收推送。', 'warn');
      return;
    }
    if (!hasPush()) {
      show('go', false);
      show('iosSteps', ios);
      setStatus(ios
        ? '还没进到「主屏幕网页应用」里。请按上面三步先添加到主屏幕，再回桌面点图标打开。'
        : '这个浏览器没有 Web 推送能力，请改用 Chrome / Edge / Firefox。', 'warn');
      return;
    }
    show('iosSteps', false);
    show('go', true);
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      setStatus('通知权限被拒绝了。请到 iPhone「设置 → 通知」里找到「THS 推送」并允许，然后回来重试。', 'warn');
      return;
    }
    if (!state.code) {
      setStatus('输入电脑屏幕上显示的 6 位配对码，然后点下面的按钮。', '');
      return;
    }
    setStatus('点下面的按钮完成配对。系统问通知权限时请点「允许」。', '');
  }

  function boot() {
    var fromUrl = readUrlParams();
    if (fromUrl !== null) {
      state.token = fromUrl.token;
      state.key = fromUrl.key;
      state.code = fromUrl.code;
      if (fromUrl.label) state.label = fromUrl.label;
      writeStore();
    } else {
      var stored = readStore();
      if (stored !== null) {
        state.token = typeof stored.token === 'string' ? stored.token : '';
        state.key = typeof stored.key === 'string' ? stored.key : '';
        state.code = typeof stored.code === 'string' ? stored.code : '';
        state.label = typeof stored.label === 'string' && stored.label ? stored.label : 'THS Buddy';
      }
    }
    render();
  }

  el('go').addEventListener('click', function () { run(); });
  el('codeInput').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') { event.preventDefault(); run(); }
  });
  el('copy').addEventListener('click', function () {
    var node = el('manualText');
    node.select();
    if (navigator.clipboard) navigator.clipboard.writeText(node.value);
    setStatus('已复制。发到电脑上 THS Buddy 控制台的「手动配对」里。', 'ok');
  });
  el('copyDiag').addEventListener('click', function () {
    if (navigator.clipboard) navigator.clipboard.writeText(el('diagText').textContent);
  });

  boot();
})();
