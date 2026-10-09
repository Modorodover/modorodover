const DEFAULTS = { enabled: true, targetLang: 'ru', minWords: 2, showOriginalOnHover: true };

const $ = (id) => document.getElementById(id);
const status = (text) => {
  $('status').textContent = text;
  setTimeout(() => { $('status').textContent = ''; }, 1500);
};

chrome.storage.sync.get(DEFAULTS, (s) => {
  $('enabled').checked = s.enabled;
  $('targetLang').value = s.targetLang;
  $('minWords').value = s.minWords;
  $('showOriginalOnHover').checked = s.showOriginalOnHover;
});

$('enabled').addEventListener('change', (e) => chrome.storage.sync.set({ enabled: e.target.checked }));
$('targetLang').addEventListener('change', (e) => chrome.storage.sync.set({ targetLang: e.target.value }));
$('showOriginalOnHover').addEventListener('change', (e) => chrome.storage.sync.set({ showOriginalOnHover: e.target.checked }));
$('minWords').addEventListener('change', (e) => {
  const v = Math.min(10, Math.max(1, parseInt(e.target.value, 10) || DEFAULTS.minWords));
  e.target.value = v;
  chrome.storage.sync.set({ minWords: v });
});

$('clearCache').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'clearCache' }, () => status('Кэш очищен'));
});
