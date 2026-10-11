# 连接麦当劳：已核实的接入方式

2026-10-11 核查官方 [接入指南](https://github.com/M-China/mcd-mcp-server/blob/main/README.md)、[登录页](https://open.mcd.cn/mcp/login)及公开前端脚本。官方流程是手机号短信登录，回首页打开控制台，首次使用点激活、同意条款，然后复制 Token。官方指南要求通过 Bearer Token 访问 MCP 服务，未公布第三方 OAuth 授权地址、回调注册或登录结果回传接口。当前公开脚本中的 postMessage 仅为依赖库调度，未找到业务授权回传。

网页嵌入官方页面不会赋予跨域 DOM 读取能力，因而不能靠 iframe 自动取得官方页面中的 Token。当前不伪装成“授权后自动连接”，也不在本站收集麦当劳手机号、验证码或密码。未来若官方提供合作授权接口，可替换第一步而保留本站会话接口。

当前实现用官方手机号登录作为第一步；用户复制一次，返回点“粘贴并连接”。剪贴板读取只发生在用户点击后，拒绝读取时展开手动粘贴入口。支持官方整段 MCP JSON、Authorization 行、Bearer 值和单独 Token；仅提取指向官方 mcp.mcd.cn 的配置凭证，不读取其他服务的配置凭证，不在浏览器存储或日志中保留连接码。

## 集成

保留现有 `connect-form` 提交/API 处理，嵌入 `web/connection-onboarding.js` 后调用：

```js
const connectionOnboarding = McdConnectionOnboarding.mount();
// 原 open-connect handler 的最后一行改为：
connectionOnboarding?.focus();
// showConnection 更新 connectionAvailable 后同步：
connectionOnboarding?.setAvailable(connectionAvailable);
```

模块的 submit 捕获处理先规范化配置，再交给现有 API 提交监听。不要另增 API 提交监听。模块不会在页面返回或获得焦点时自动读取剪贴板。

下面片段替换原连接 dialog，全部旧 ID/name 兼容：

```html
<dialog id="connect-dialog" aria-labelledby="connect-heading">
  <div class="dialog-top">
    <h2 id="connect-heading">把吃过的麦当劳，收进手账</h2>
    <button class="close" type="button" data-close="connect-dialog" aria-label="关闭连接窗口">×</button>
  </div>
  <form id="connect-form">
    <div class="form-body">
      <p id="connection-note" class="form-note">连接后，订单里的门店和餐品会自动整理，省得一项项填写。</p>
      <ol class="connect-steps">
        <li><strong>去麦当劳登录</strong><p>用手机号和短信验证码登录，和登录麦当劳一样。</p>
          <a class="primary connect-login" id="connect-official-login" href="https://open.mcd.cn/mcp/login" target="_blank" rel="noopener noreferrer">去麦当劳登录 ↗</a>
        </li>
        <li><strong>复制一次，回来连接</strong><p id="connect-help">登录后点“控制台”，第一次使用先点“激活”并同意条款，再点“复制 Token”。</p>
          <button class="primary" id="connect-paste" type="button">粘贴并连接</button>
        </li>
      </ol>
      <details id="connect-manual" class="connect-manual">
        <summary>已经复制了？也可以直接粘贴</summary>
        <label class="field">粘贴连接码<input id="connect-token" name="token" type="password" maxlength="512" autocomplete="off" required placeholder="长按粘贴，不用手动输入"></label>
        <p class="store-help">官网叫它 Token；复制整段配置也可以。</p>
        <div class="form-actions"><button class="primary" type="submit" id="connect-submit">连接我的订单</button></div>
      </details>
      <label class="store-help" id="remember-field" hidden><input id="connect-remember" type="checkbox" checked> 下次打开继续用（30 天）</label>
      <p id="connect-status" class="store-help" role="status" aria-live="polite"></p>
    </div>
  </form>
</dialog>
```

把“复制 Token”的官方按钮名保留，方便用户在官方页面找到同名按钮；其余界面不使用 MCP、Bearer 等开发术语。主页面无需连接即可找门店和记一餐，连接只用来省去手动整理订单。

建议 CSS（父页面已有红黄色变量时替换字面量即可）：

```css
#connect-dialog { max-width:580px; }
.connect-steps { list-style:none; padding:0; margin:0; counter-reset:connect; display:grid; gap:20px; }
.connect-steps>li { counter-increment:connect; position:relative; padding-left:42px; }
.connect-steps>li::before { content:counter(connect); position:absolute; left:0; top:0; width:28px; height:28px; border-radius:50%; display:grid; place-items:center; background:#ffbc0d; color:#29251f; font-weight:800; }
.connect-steps strong { font-size:17px; }
.connect-steps p { margin:7px 0 12px; line-height:1.6; font-size:14px; }
.connect-login { display:inline-flex; align-items:center; justify-content:center; text-decoration:none; min-height:46px; padding:12px 18px; }
.connect-manual { margin-top:24px; padding-top:16px; border-top:1px solid var(--line); }
.connect-manual summary { cursor:pointer; min-height:44px; display:flex; align-items:center; color:var(--muted); }
.connect-manual .field { margin-top:12px; }
#connect-token { font-size:16px; min-height:48px; }
@media(max-width:680px) { .connect-login,#connect-paste { width:100%; } }
```

测试：`node tests/test_connection_onboarding.cjs`。真实订单/API 验收沿用已有云端测试；新增浏览器用例应验证拒绝剪贴板时可手动粘贴、官网入口新标签打开、整段配置规范化和提交后输入清空，不需要真实凭证。
