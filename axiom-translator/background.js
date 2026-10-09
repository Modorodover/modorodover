// Сервис-воркер: делает запросы к переводчику (из content script их блокирует CORS)
// и хранит кэш переводов, чтобы не переводить одно и то же дважды.

const CACHE_KEY = 'translationCache';
const CACHE_LIMIT = 5000;

let cache = new Map();
let cacheLoaded = null;
let saveTimer = null;

function loadCache() {
  if (!cacheLoaded) {
    cacheLoaded = chrome.storage.local.get(CACHE_KEY).then((data) => {
      const entries = data[CACHE_KEY];
      if (Array.isArray(entries)) cache = new Map(entries);
    }).catch(() => {});
  }
  return cacheLoaded;
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    // Оставляем только самые свежие записи.
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    chrome.storage.local.set({ [CACHE_KEY]: [...cache.entries()] }).catch(() => {});
  }, 3000);
}

async function translate(text, targetLang) {
  await loadCache();
  const key = targetLang + '\u0000' + text;
  if (cache.has(key)) return cache.get(key);

  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t' +
    '&tl=' + encodeURIComponent(targetLang) +
    '&q=' + encodeURIComponent(text);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const data = await resp.json();

  const translated = (data[0] || []).map((part) => part && part[0]).filter(Boolean).join('');
  const result = { translated, sourceLang: data[2] || '' };

  cache.set(key, result);
  scheduleSave();
  return result;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'translate') {
    translate(msg.text, msg.targetLang || 'ru')
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // ответ асинхронный
  }
  if (msg && msg.type === 'clearCache') {
    cache.clear();
    chrome.storage.local.remove(CACHE_KEY).finally(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
