(function () {
  var params = new URLSearchParams(location.hash.replace(/^#/, ""));
  var token = params.get("t");
  var vapid = params.get("k");
  var label = params.get("s") || "THS Buddy";
  var statusEl = document.getElementById("status");
  var manualBox = document.getElementById("manual");
  var manualText = document.getElementById("manualText");
  var copyBtn = document.getElementById("copy");

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = kind || "";
  }

  function fromBase64Url(value) {
    var normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4 !== 0) normalized += "=";
    var raw = atob(normalized);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  function showManual(text) {
    manualBox.hidden = false;
    manualText.value = text;
  }

  copyBtn.addEventListener("click", function () {
    manualText.select();
    if (navigator.clipboard) navigator.clipboard.writeText(manualText.value);
    setStatus("已复制。回到电脑上的 THS Buddy 控制台，粘贴到“手动配对”里。", "ok");
  });

  async function deliver(subscription) {
    var payload = {
      kind: "ths-buddy-pair",
      token: token,
      label: label,
      subscription: { endpoint: subscription.endpoint, keys: subscription.keys }
    };
    var text = JSON.stringify(payload);
    showManual(text);
    setStatus("正在把配对信息回传给电脑…", "");
    try {
      var response = await fetch("https://ntfy.sh/thsbuddy-pair-" + token, {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache": "no", "X-Cache": "no" },
        body: text
      });
      if (response.ok) {
        setStatus("配对信息已回传。请回到电脑上的 THS Buddy，应已显示“配对成功”。", "ok");
        return;
      }
      setStatus("自动回传失败（HTTP " + response.status + "）。请复制下面的文本，粘贴到电脑上的 THS Buddy 控制台。", "warn");
    } catch (error) {
      setStatus("自动回传失败（" + error.message + "）。请复制下面的文本，粘贴到电脑上的 THS Buddy 控制台。", "warn");
    }
  }

  async function start() {
    if (!token || !vapid) { setStatus("链接不完整：缺少配对参数，请在 THS Buddy 控制台重新生成二维码。", "warn"); return; }
    if (!("serviceWorker" in navigator)) { setStatus("这个浏览器不支持 Service Worker，请换 Chrome / Edge / Safari 打开。", "warn"); return; }
    if (!("PushManager" in window)) {
      setStatus("这个浏览器不支持 Web 推送。iOS 请用 Safari 打开，点“分享 → 添加到主屏幕”，再从主屏幕图标进入本页。", "warn");
      return;
    }
    try {
      var registration = await navigator.serviceWorker.register("sw.js", { scope: "./" });
      await navigator.serviceWorker.ready;
      if (Notification.permission === "denied") { setStatus("通知权限已被拒绝。请在浏览器设置里对本网站允许通知，然后刷新本页。", "warn"); return; }
      var permission = await Notification.requestPermission();
      if (permission !== "granted") { setStatus("没有获得通知权限，无法接收推送。", "warn"); return; }
      var subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(vapid) });
      }
      await deliver(subscription.toJSON());
    } catch (error) {
      setStatus("配对失败：" + (error && error.message ? error.message : String(error)), "warn");
    }
  }

  start();
})();