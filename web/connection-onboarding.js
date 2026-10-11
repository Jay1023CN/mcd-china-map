/* Official login stays on open.mcd.cn. No credentials or clipboard are persisted here. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.McdConnectionOnboarding = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  const OFFICIAL_LOGIN = 'https://open.mcd.cn/mcp/login';
  function plainToken(value) {
    if (typeof value !== 'string') return '';
    const token = value.trim().replace(/^Bearer\s+/i, '');
    if (!token.length || token.length > 512 || !/^[A-Za-z0-9._~+\/=\-]+$/.test(token)) return '';
    if (/^https?:\/\//i.test(token) || token === 'YOUR_MCP_TOKEN') return '';
    return token;
  }
  function extractToken(value) {
    if (typeof value !== 'string' || value.length > 20000) return '';
    const text = value.trim();
    // The official guide offers both a token and a complete MCP configuration.
    if (text.startsWith('{')) {
      try {
        const config = JSON.parse(text);
        for (const server of Object.values(config.mcpServers || {})) {
          if (!server || typeof server.url !== 'string') continue;
          const url = new URL(server.url);
          if (url.protocol !== 'https:' || url.hostname !== 'mcp.mcd.cn' || url.port) continue;
          const header = Object.entries(server.headers || {}).find(([key]) => key.toLowerCase() === 'authorization');
          const token = header && plainToken(header[1]);
          if (token) return token;
        }
      } catch (_) { /* Incomplete configuration should remain editable. */ }
      return '';
    }
    const authorization = text.match(/^Authorization\s*:\s*(.+)$/i);
    return plainToken(authorization ? authorization[1] : text);
  }
  function mount(options = {}) {
    const doc = options.document || document;
    const form = doc.getElementById('connect-form');
    const input = doc.getElementById('connect-token');
    const paste = doc.getElementById('connect-paste');
    const login = doc.getElementById('connect-official-login');
    const manual = doc.getElementById('connect-manual');
    const status = doc.getElementById('connect-status');
    if (!form || !input || !paste || !login || form.dataset.onboardingMounted) return null;
    form.dataset.onboardingMounted = 'true';
    login.href = OFFICIAL_LOGIN;
    const say = text => { if (status) status.textContent = text; };
    const manualPaste = text => {
      if (manual) manual.open = true;
      say(text);
      input.focus();
    };
    function normalize() {
      const token = extractToken(input.value);
      if (token) input.value = token;
      return token;
    }
    const onPaste = event => {
      const copied = event.clipboardData?.getData('text');
      const token = extractToken(copied);
      if (token) {
        event.preventDefault();
        input.value = token;
        input.dispatchEvent(new Event('input', {bubbles:true}));
        say('连接码已填好，点“连接我的订单”就可以了。');
      }
    };
    const onSubmit = event => {
      if (normalize()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      manualPaste('这段内容里没找到连接码。请在麦当劳控制台点“复制 Token”，再粘贴过来。');
    };
    const onLogin = () => {
      if (manual) manual.open = false;
      say('登录后点“控制台”；第一次使用先点“激活”并同意条款，再复制 Token。回来点“粘贴并连接”。');
      paste.hidden = false;
    };
    const onClipboard = async () => {
      paste.disabled = true;
      try {
        const clipboard = options.clipboard || (typeof navigator !== 'undefined' && navigator.clipboard);
        if (!clipboard?.readText) throw new Error('manual');
        const token = extractToken(await clipboard.readText());
        if (!token) {
          manualPaste('还没复制到连接码。回麦当劳控制台点“复制 Token”，或者直接在下面粘贴。');
          return;
        }
        input.value = token;
        if (manual) manual.open = true;
        form.requestSubmit();
      } catch (_) {
        manualPaste('请长按下面的输入框，选择“粘贴”，再点“连接我的订单”。');
      } finally { paste.disabled = !!doc.getElementById('connect-submit')?.disabled; }
    };
    input.addEventListener('paste', onPaste);
    form.addEventListener('submit', onSubmit, true);
    login.addEventListener('click', onLogin);
    paste.addEventListener('click', onClipboard);
    return {
      focus() { login.focus(); },
      setAvailable(available) { paste.disabled = !available; },
      destroy() {
        input.removeEventListener('paste', onPaste);
        form.removeEventListener('submit', onSubmit, true);
        login.removeEventListener('click', onLogin);
        paste.removeEventListener('click', onClipboard);
        delete form.dataset.onboardingMounted;
      }
    };
  }
  return {extractToken, mount, OFFICIAL_LOGIN};
});
