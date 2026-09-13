// Script injected into the card iframe. Ported from ts/reviewer/index.ts (script re-evaluation, MathJax lazy
// load, typed-answer focus/Enter) and qt/aqt/reviewer.py (play button commands). Kept as a string so the
// iframe stays sandboxed.
// Copyright: Ankitects Pty Ltd and contributors; anki-local contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
export const REVIEWER_JS = String.raw`
(function () {
  var post = function (m) { parent.postMessage(m, '*'); };
  window.pycmd = function (cmd) { post({ pycmd: cmd }); return false; };
  window._typeAnsPress = function () { if (window.event && window.event.key === 'Enter') post({ pycmd: 'ans' }); };
  var mathjaxRegex = /\\\[(.*?)\\\]|\\\((.*?)\\\)/su;
  var mathjaxLoading = null;
  function lazyLoadMathJax() {
    return mathjaxLoading || (mathjaxLoading = new Promise(function (resolve, reject) {
      window.MathJax = { tex: { displayMath: [['\\[', '\\]']], inlineMath: [['\\(', '\\)']], processEscapes: false, processEnvironments: false, processRefs: false, packages: { '[+]': ['noerrors', 'mathtools'] } }, loader: { load: ['[tex]/noerrors', '[tex]/mathtools'] }, startup: { typeset: false } };
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml-full.js';
      s.onload = function () { resolve(); }; s.onerror = function () { reject(new Error('Failed to load MathJax')); };
      document.head.appendChild(s);
    }));
  }
  function replaceScript(old) {
    return new Promise(function (resolve) {
      var s = document.createElement('script'), wait = !!old.src;
      if (wait) { s.addEventListener('load', function () { resolve(); }); s.addEventListener('error', function () { resolve(); }); }
      for (var i = 0; i < old.attributes.length; i++) s.setAttribute(old.attributes[i].name, old.attributes[i].value);
      s.appendChild(document.createTextNode(old.innerHTML));
      old.replaceWith(s);
      if (!wait) resolve();
    });
  }
  async function setInnerHTML(el, html) {
    var vids = el.getElementsByTagName('video');
    for (var i = 0; i < vids.length; i++) { vids[i].pause(); while (vids[i].firstChild) vids[i].removeChild(vids[i].firstChild); vids[i].load(); }
    el.innerHTML = html;
    var scripts = Array.prototype.slice.call(el.getElementsByTagName('script'));
    for (var j = 0; j < scripts.length; j++) await replaceScript(scripts[j]);
  }
  function renderError(type) { return function (e) { return ('<div>Invalid ' + type + ' on card: ' + String(e).substring(0, 2000) + '</div>'); }; }
  var typeans;
  window._updateQA = async function (html, bodyclass, answer) {
    var qa = document.getElementById('qa');
    var hasMath = mathjaxRegex.test(html);
    if (hasMath) { try { await lazyLoadMathJax(); } catch (e) { console.error(e); } }
    qa.style.opacity = '0';
    try { await setInnerHTML(qa, html); } catch (e) { await setInnerHTML(qa, renderError('html')(e)); }
    document.body.className = bodyclass;
    if (!answer) window.scrollTo(0, 0);
    if (hasMath && window.MathJax && MathJax.startup) {
      await MathJax.startup.promise.then(function () { MathJax.typesetClear(); return MathJax.typesetPromise([qa]); }).catch(renderError('MathJax'));
    }
    qa.style.opacity = '1';
    if (answer) { var a = document.getElementById('answer'); if (a) a.scrollIntoView(); }
    typeans = document.getElementById('typeans');
    if (typeans && !answer) typeans.focus();
    post({ shown: answer ? 'a' : 'q', text: qa.innerText.slice(0, 300) });
  };
  window.getTypedAnswer = function () { return typeans ? typeans.value : null; };
  addEventListener('keydown', function (e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    post({ key: e.key });
  });
  addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.show) window._updateQA(d.show.html, d.show.bodyclass, !!d.show.answer).catch(function (e) { post({ error: String(e) }); });
    if (d.getTyped) post({ typed: window.getTypedAnswer() });
  });
  post({ ready: true });
})();
`;

// Converted from ts/reviewer/reviewer.scss and qt/aqt/data/web/css/webview.scss (Anki palette values inlined).
export const REVIEWER_CSS = `
:root{--canvas:#f5f5f5;--fg:#020202;--fg-link:#2e6ee0}
.nightMode{--canvas:#2c2c2c;--fg:#fcfcfc;--fg-link:#4a9aff}
*{box-sizing:content-box}
body{color:var(--fg);background:var(--canvas);margin:20px;overscroll-behavior:none;overflow-wrap:break-word;background-size:cover;background-repeat:no-repeat;background-position:top;background-attachment:fixed}
body.nightMode{background-color:var(--canvas);color:var(--fg)}
a{color:var(--fg-link);text-decoration:none}
h1{margin-bottom:.2em}
hr{background-color:#737373;margin:1em 0;border:none;height:1px}
img{max-width:100%;max-height:95vh}
li{text-align:start}
pre{text-align:left}
#typeans{width:100%;box-sizing:border-box;line-height:1.75}
code#typeans{white-space:pre-wrap;font-variant-ligatures:none}
.typeGood{background:#afa;color:black}
.typeBad{color:black;background:#faa}
.typeMissed{color:black;background:#ccc}
button{margin:1em .5em}
.replay-button{text-decoration:none;display:inline-flex;vertical-align:middle;margin:3px}
.replay-button svg{width:40px;height:40px}
.replay-button svg circle{fill:#fff;stroke:#414141}
.replay-button svg path{fill:#414141}
.nightMode .latex{filter:invert(100%)}
.drawing{zoom:50%}
.nightMode img.drawing{filter:invert(1) hue-rotate(180deg)}
.card{font-family:arial;font-size:20px;text-align:center;color:var(--fg);background-color:var(--canvas)}
`;
