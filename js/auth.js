/**
 * LUT分析工具箱 · 密码验证模块
 * 纯前端密码门 —— 使用 SHA-256 哈希比对
 *
 * 安全说明：
 *   此方案为"君子协议"级别，能防止偶然浏览，但无法抵御有技术能力的绕过者。
 *   如需更强保护，应在后端服务做密码校验。
 *
 * 修改密码：
 *   1. 将新密码通过 https://emn178.github.io/online-tools/sha256.html 生成 SHA-256
 *   2. 替换下方 PASSWORD_HASH 的值
 */

(function () {
    'use strict';

    var PASSWORD_HASH = 'd87da8c4122a121200bb11b5389262c874d97f55972a0acd2c246fadad132c72';
    var SESSION_KEY = 'lut_toolbox_authenticated';
    var AUTH_OVERLAY_ID = 'auth-overlay';

    function sha256(str) {
        if (window.crypto && window.crypto.subtle) {
            return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
                .then(function (buf) {
                    var bytes = new Uint8Array(buf);
                    var hex = '';
                    for (var i = 0; i < bytes.length; i++) {
                        hex += ('0' + bytes[i].toString(16)).slice(-2);
                    }
                    return hex;
                });
        }
        return Promise.reject(new Error('crypto.subtle not supported'));
    }

    function isAuthenticated() {
        try {
            return sessionStorage.getItem(SESSION_KEY) === '1';
        } catch (e) {
            return false;
        }
    }

    function setAuthenticated() {
        try {
            sessionStorage.setItem(SESSION_KEY, '1');
        } catch (e) {}
    }

    function showOverlay() {
        if (document.getElementById(AUTH_OVERLAY_ID)) return;

        var overlay = document.createElement('div');
        overlay.id = AUTH_OVERLAY_ID;
        overlay.innerHTML =
            '<div class="auth-box">' +
                '<div class="auth-lock">' +
                    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
                        '<rect x="3" y="11" width="18" height="11" rx="2"/>' +
                        '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>' +
                    '</svg>' +
                '</div>' +
                '<h2 class="auth-title">LUT分析工具箱</h2>' +
                '<p class="auth-subtitle">请输入访问密码</p>' +
                '<form class="auth-form" id="auth-form" autocomplete="off">' +
                    '<input type="password" id="auth-input" class="auth-input" placeholder="访问密码" autofocus>' +
                    '<button type="submit" class="auth-submit">进入</button>' +
                '</form>' +
                '<p class="auth-error" id="auth-error"></p>' +
                '<p class="auth-footer">PRIVATE ACCESS ONLY</p>' +
            '</div>';

        document.body.appendChild(overlay);

        var form = overlay.querySelector('#auth-form');
        var input = overlay.querySelector('#auth-input');
        var error = overlay.querySelector('#auth-error');
        var submitBtn = overlay.querySelector('.auth-submit');

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var val = input.value.trim();
            if (!val) return;

            error.textContent = '';
            error.classList.remove('show');
            submitBtn.classList.add('loading');
            submitBtn.disabled = true;

            sha256(val).then(function (hash) {
                if (hash === PASSWORD_HASH) {
                    setAuthenticated();
                    showPage();
                    overlay.style.opacity = '0';
                    overlay.style.transition = 'opacity 0.3s ease';
                    setTimeout(function () {
                        overlay.remove();
                    }, 300);
                } else {
                    error.textContent = '密码错误，请重试';
                    error.classList.add('show');
                    input.value = '';
                    input.focus();
                }
            }).catch(function () {
                error.textContent = '浏览器不支持密码验证';
                error.classList.add('show');
            }).then(function () {
                submitBtn.classList.remove('loading');
                submitBtn.disabled = false;
            });
        });

        setTimeout(function () { input.focus(); }, 100);
    }

    function hidePage() {
        if (document.getElementById('auth-hide-style')) return;
        var style = document.createElement('style');
        style.id = 'auth-hide-style';
        style.textContent = 'body > *:not(#' + AUTH_OVERLAY_ID + ') { visibility: hidden !important; }';
        document.head.appendChild(style);
    }

    function showPage() {
        var style = document.getElementById('auth-hide-style');
        if (style) style.remove();
    }

    function init() {
        if (isAuthenticated()) {
            showPage();
        } else {
            hidePage();
            showOverlay();
        }
    }

    if (!isAuthenticated()) hidePage();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
