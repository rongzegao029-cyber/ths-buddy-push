/* THS Buddy push service worker — version 3 */
var VERSION = '3';
var STATE_URL = 'state.json';
var CACHE_NAME = 'ths-buddy-pair';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

function notificationOptions(payload) {
  var level = payload.level || 'signal';
  var options = {
    body: payload.body || '',
    tag: payload.tag || 'ths-buddy',
    renotify: true,
    timestamp: typeof payload.at === 'number' ? payload.at : Date.now(),
    data: { url: payload.url || './', level: level }
  };
  if (level === 'critical' || level === 'risk') {
    options.requireInteraction = true;
    options.vibrate = [200, 100, 200, 100, 200];
  }
  return options;
}

self.addEventListener('push', function (event) {
  var payload = {};
  if (event.data) {
    try { payload = event.data.json(); } catch (error) { payload = { body: event.data.text() }; }
  }
  var title = payload.title || 'THS Buddy';
  event.waitUntil(self.registration.showNotification(title, notificationOptions(payload)));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url === target && 'focus' in list[i]) return list[i].focus();
    }
    return self.clients.openWindow(target);
  }));
});

function readState() {
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(STATE_URL);
  }).then(function (response) {
    return response ? response.json() : null;
  }).catch(function () { return null; });
}

function reportSubscription(subscription) {
  if (!subscription) return Promise.resolve();
  return readState().then(function (state) {
    if (!state || !state.topics || !state.topics.length) return;
    var body = JSON.stringify({
      kind: 'ths-buddy-resubscribe',
      label: state.label || '手机',
      subscription: { endpoint: subscription.endpoint, keys: subscription.keys }
    });
    return Promise.all(state.topics.map(function (topic) {
      return fetch('https://ntfy.sh/' + topic, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: body
      }).catch(function () { return null; });
    }));
  });
}

/* 系统轮换订阅时重新上报一次，否则 THS Buddy 会一直推到旧端点。 */
self.addEventListener('pushsubscriptionchange', function (event) {
  var next = event.newSubscription || self.registration.pushManager.getSubscription();
  event.waitUntil(Promise.resolve(next).then(reportSubscription));
});
