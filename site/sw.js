self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (event) { event.waitUntil(self.clients.claim()); });
self.addEventListener("push", function (event) {
  var payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (error) {
    payload = { title: "THS Buddy", body: event.data ? event.data.text() : "" };
  }
  var title = payload.title || "THS Buddy";
  var options = {
    body: payload.body || "",
    tag: payload.tag || "ths-buddy",
    renotify: true,
    data: { url: payload.url || "./" }
  };
  if (payload.level === "critical" || payload.level === "risk") {
    options.requireInteraction = true;
    options.vibrate = [200, 100, 200, 100, 200];
  }
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url === target && "focus" in list[i]) return list[i].focus();
    }
    return self.clients.openWindow(target);
  }));
});