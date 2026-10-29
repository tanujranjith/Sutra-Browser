const DEFAULT_SUTRA_URL = 'https://tanujranjith.github.io/Sutra/Sutra.html';
const input = document.getElementById('sutraUrl');
const savedEl = document.getElementById('saved');

chrome.storage.sync.get({ sutraAppUrl: DEFAULT_SUTRA_URL }, (items) => {
    input.value = items.sutraAppUrl || DEFAULT_SUTRA_URL;
});

document.getElementById('saveBtn').addEventListener('click', () => {
    const value = String(input.value || '').trim() || DEFAULT_SUTRA_URL;
    chrome.storage.sync.set({ sutraAppUrl: value }, () => {
        savedEl.classList.add('show');
        setTimeout(() => savedEl.classList.remove('show'), 1500);
    });
});
