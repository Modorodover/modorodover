// Content script: находит тексты пользователей на axiom.trade и заменяет их переводом.
// Оригинал показывается во всплывающей подсказке при наведении (если включено).

(() => {
  'use strict';

  const DEFAULTS = {
    enabled: true,
    targetLang: 'ru',
    minWords: 2,
    showOriginalOnHover: true,
    showButton: true,
  };

  // Подписи интерфейса, которые переводить не нужно (сравнение без учёта регистра).
  const IGNORE_PHRASES = new Set([
    'follow', 'following', 'unfollow', 'block', 'unblock', 'called @', 'since call',
    'pump.fun callout', 'callout', 'buy', 'sell', 'market cap', 'liquidity', 'volume',
    'holders', 'top 10 holders', 'dev holding', 'snipers', 'insiders', 'bundlers',
  ]);

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'CODE', 'PRE', 'SVG', 'CANVAS', 'IFRAME',
  ]);

  const BTN_CLASS = 'axiom-tr-btn';
  const MAX_CONCURRENT = 4;
  const MAX_TEXT_LENGTH = 2000;

  let settings = { ...DEFAULTS };

  // textNode -> { original, translated }
  const nodeState = new WeakMap();
  // Узлы, которые мы изменили (для отката при выключении).
  const touchedNodes = new Set();
  // Элементы, которым мы поставили title.
  const titledElements = new Set();

  // text -> Promise<string|null>, чтобы одинаковые строки переводились один раз.
  const pending = new Map();
  const queue = [];
  let active = 0;

  // ---------- Фильтр: стоит ли переводить текст ----------

  function looksTranslatable(text) {
    const t = text.trim();
    if (t.length < 2 || t.length > MAX_TEXT_LENGTH) return false;
    if (!/\p{L}/u.test(t)) return false; // нет букв: цифры, цены, проценты
    if (IGNORE_PHRASES.has(t.toLowerCase())) return false;

    // Уже на кириллице.
    const letters = t.match(/\p{L}/gu) || [];
    const cyr = t.match(/[Ѐ-ӿ]/g) || [];
    if (cyr.length / letters.length > 0.5) return false;

    // Ссылки, адреса контрактов/кошельков, тикеры, суммы вида $212K, 1.34x, 3m.
    if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return false;
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}(pump|bonk)?$/.test(t)) return false;
    if (/^0x[0-9a-fA-F]{6,}$/.test(t)) return false;
    if (/^\$[A-Za-z0-9]{1,12}$/.test(t)) return false;
    if (/^[$€]?[\d.,]+\s*[KMBTkmbt%x×]?$/.test(t)) return false;
    if (/^\d+\s*[smhdw]$/.test(t)) return false;
    if (/^@\S+$/.test(t)) return false;

    const words = t.split(/\s+/).filter((w) => /\p{L}/u.test(w));
    if (words.length < settings.minWords) return false;

    return true;
  }

  function isInSkippedElement(node) {
    for (let el = node.parentElement; el; el = el.parentElement) {
      if (SKIP_TAGS.has(el.tagName)) return true;
      if (el.isContentEditable) return true;
      if (el.classList.contains(BTN_CLASS)) return true;
      if (el.getAttribute('translate') === 'no' || el.classList.contains('notranslate')) return true;
    }
    return false;
  }

  // ---------- Очередь переводов ----------

  function requestTranslation(text) {
    if (pending.has(text)) return pending.get(text);
    const p = new Promise((resolve) => {
      queue.push({ text, resolve });
      pump();
    });
    pending.set(text, p);
    // Неудачные запросы не кэшируем, чтобы можно было повторить позже.
    p.then((r) => { if (r === undefined) pending.delete(text); });
    return p;
  }

  function pump() {
    while (active < MAX_CONCURRENT && queue.length) {
      const { text, resolve } = queue.shift();
      active++;
      sendMessage({ type: 'translate', text, targetLang: settings.targetLang })
        .then((resp) => {
          if (!resp || !resp.ok) return resolve(undefined);
          const same = !resp.translated ||
            resp.sourceLang === settings.targetLang ||
            resp.translated.trim() === text;
          resolve(same ? null : resp.translated);
        })
        .catch(() => resolve(undefined))
        .finally(() => { active--; pump(); });
    }
  }

  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(resp);
        });
      } catch (e) {
        reject(e); // расширение перезагружено, контекст недействителен
      }
    });
  }

  // ---------- Обработка узлов ----------

  async function handleTextNode(node) {
    if (!settings.enabled) return;
    const value = node.nodeValue;
    if (!value) return;

    const st = nodeState.get(node);
    if (st) {
      // Это наш перевод или оригинал, показанный кнопкой.
      if (value === st.translated || (st.showingOriginal && value === st.original)) return;
      // React заменил текст — старая кнопка больше не нужна.
      if (st.btn) st.btn.remove();
      nodeState.delete(node);
    }

    if (!looksTranslatable(value) || isInSkippedElement(node)) return;

    const original = value;
    const core = original.trim();
    const translated = await requestTranslation(core);
    if (!translated || !settings.enabled) return;
    // Пока ждали перевод, React мог поменять текст.
    if (!node.isConnected || node.nodeValue !== original) return;

    const lead = original.match(/^\s*/)[0];
    const trail = original.match(/\s*$/)[0];
    const newValue = lead + translated + trail;

    const state = { original, translated: newValue, showingOriginal: false, btn: null };
    nodeState.set(node, state);
    touchedNodes.add(node);
    node.nodeValue = newValue;

    const parent = node.parentElement;
    if (settings.showOriginalOnHover && parent && !parent.hasAttribute('title')) {
      parent.setAttribute('title', core);
      parent.dataset.axiomTrTitle = '1';
      titledElements.add(parent);
    }

    if (settings.showButton && node.parentNode) {
      state.btn = createToggleButton(node, state);
      node.parentNode.insertBefore(state.btn, node.nextSibling);
    }
  }

  // ---------- Кнопка «оригинал / перевод» ----------

  function injectStyles() {
    if (document.getElementById('axiom-tr-style')) return;
    const style = document.createElement('style');
    style.id = 'axiom-tr-style';
    style.textContent = `
      .${BTN_CLASS} {
        display: inline-block; margin-left: 5px; padding: 0 5px;
        font: 600 10px/16px system-ui, sans-serif; letter-spacing: .2px;
        color: #8b8e99; background: rgba(139,142,153,.12);
        border: 1px solid rgba(139,142,153,.25); border-radius: 4px;
        cursor: pointer; user-select: none; vertical-align: middle; white-space: nowrap;
      }
      .${BTN_CLASS}:hover { color: #e8e8ea; background: rgba(139,142,153,.25); }
      .${BTN_CLASS}[data-state="original"] { color: #4ade80; border-color: rgba(74,222,128,.4); }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function updateButton(btn, state) {
    btn.textContent = state.showingOriginal ? 'перевод' : 'ориг.';
    btn.dataset.state = state.showingOriginal ? 'original' : 'translated';
    btn.title = state.showingOriginal ? 'Показать перевод' : 'Показать оригинал';
  }

  function createToggleButton(node, state) {
    injectStyles();
    const btn = document.createElement('span');
    btn.className = BTN_CLASS + ' notranslate';
    btn.setAttribute('role', 'button');
    btn.setAttribute('translate', 'no');
    updateButton(btn, state);

    // Не даём клику дойти до карточки/ссылки сайта.
    const block = (e) => { e.stopPropagation(); e.preventDefault(); };
    btn.addEventListener('pointerdown', block);
    btn.addEventListener('mousedown', block);
    btn.addEventListener('mouseup', block);
    btn.addEventListener('click', (e) => {
      block(e);
      state.showingOriginal = !state.showingOriginal;
      node.nodeValue = state.showingOriginal ? state.original : state.translated;
      updateButton(btn, state);
    });
    return btn;
  }

  function scan(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      handleTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) handleTextNode(n);
  }

  function restoreAll() {
    for (const node of touchedNodes) {
      const st = nodeState.get(node);
      if (st) {
        if (node.isConnected && node.nodeValue === st.translated) node.nodeValue = st.original;
        if (st.btn) st.btn.remove();
      }
      nodeState.delete(node);
    }
    touchedNodes.clear();
    for (const el of titledElements) {
      if (el.dataset.axiomTrTitle) {
        el.removeAttribute('title');
        delete el.dataset.axiomTrTitle;
      }
    }
    titledElements.clear();
    pending.clear();
  }

  // Периодически чистим ссылки на удалённые из DOM узлы.
  setInterval(() => {
    for (const node of touchedNodes) {
      if (!node.isConnected) {
        removeButtonOf(node);
        touchedNodes.delete(node);
      }
    }
    for (const el of titledElements) if (!el.isConnected) titledElements.delete(el);
  }, 30000);

  function removeButtonOf(node) {
    const st = nodeState.get(node);
    if (st && st.btn) {
      st.btn.remove();
      st.btn = null;
    }
  }

  // ---------- Наблюдение за страницей ----------

  const observer = new MutationObserver((mutations) => {
    if (!settings.enabled) return;
    for (const m of mutations) {
      if (m.type === 'characterData') {
        handleTextNode(m.target);
      } else {
        // Сайт удалил переведённый текст — убираем и его кнопку.
        for (const n of m.removedNodes) if (n.nodeType === Node.TEXT_NODE) removeButtonOf(n);
        for (const n of m.addedNodes) scan(n);
      }
    }
  });

  function start() {
    scan(document.body);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    settings = { ...DEFAULTS, ...stored };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const prev = settings;
    settings = { ...settings };
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;

    const needsRedo = prev.enabled !== settings.enabled ||
      prev.targetLang !== settings.targetLang ||
      prev.minWords !== settings.minWords ||
      prev.showOriginalOnHover !== settings.showOriginalOnHover ||
      prev.showButton !== settings.showButton;
    if (!needsRedo) return;

    restoreAll();
    if (settings.enabled && document.body) scan(document.body);
  });
})();
