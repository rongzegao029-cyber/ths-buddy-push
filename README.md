# ths-buddy-push

THS Buddy（DeepSeek Harness 的一个树外插件 Bundle）的**手机推送配对页**。

这个仓库里没有后端、没有密钥、没有任何用户数据，只有几个静态文件：配对页面、
它的 Service Worker、PWA manifest，和两个图标。托管在 GitHub Pages 上，唯一的
作用是给手机一个 **https 源**——Service Worker 与 Web Push 只能在安全上下文里
注册，`http://` 的局域网地址不算。

## 它是怎么工作的

1. 电脑上的 THS Buddy 生成一对 VAPID 密钥，显示一个二维码，带：
   `#t=<128 位随机 token>&k=<VAPID 公钥>&c=<6 位配对码>&s=<标签>`。参数放在
   fragment 里，永远不会到达任何服务器。
2. 手机打开本页，注册 Service Worker、申请通知权限，用 `applicationServerKey` 订阅。
3. 手机产生的订阅（endpoint + p256dh + auth）回传：POST 到公开的 ntfy.sh 主题，
   失败时退化为手动粘贴回电脑。
4. 之后每次推送都是**你电脑直接加密后发到浏览器厂商的推送服务**（FCM / Mozilla
   autopush / Apple APNs）。没有中转服务器、没有每日条数上限、不需要任何续期。

## iOS 的两个硬约束（本页专门伺候它们）

- **必须「添加到主屏幕」**：iOS 16.4+ 只给「主屏幕网页应用」推送能力，普通 Safari
  标签页里 `window.PushManager` 不存在。所以 manifest 里 `display: standalone` 是必需的。
- **主屏幕网页应用与 Safari 的存储互相隔离**（WebKit #181849，MDN 亦有明确警告），
  二维码里的 fragment 传不过去。所以电脑会同时把 VAPID 公钥写进一个以 6 位配对码
  命名的公开主题；手机在主屏应用里输入这 6 位就能取到公钥并完成订阅。
  在 Android / 桌面浏览器上走 fragment 那条路，不需要输任何东西。

## 换一个源

页面要求：`text/html`（index.html）与 `application/javascript`（sw.js）。
jsDelivr、cdn.statically.io 都会把 `.html` 降级成 `text/plain`（反钓鱼策略），
页面会变成源码，不能用。GitHub Pages、Cloudflare Pages、Netlify 都可以。

注意：**路径就是推送作用域**。换域名或换路径会让已配对的手机失效，需要重新配对。
