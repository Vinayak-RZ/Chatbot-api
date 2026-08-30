(() => {
  const params = new URLSearchParams(location.search);
  const delayMs = Math.max(0, Number(params.get('delayMs') || 3000));

  const composer = document.getElementById('prompt-textarea');
  const mirror = document.querySelector('textarea[name="prompt-textarea"]');
  const form = document.getElementById('composer-form');
  const thread = document.getElementById('thread');
  const emptyHero = document.getElementById('empty-hero');
  const sendBtn = document.querySelector('[data-testid="send-button"]');
  const stopBtn = document.querySelector('[data-testid="stop-button"]');
  const voiceBtn = document.getElementById('voice-button');
  const thinkBtn = document.querySelector('.think-btn');
  const micBtn = document.querySelector('.mic-btn');

  let streaming = false;
  let stopRequested = false;
  let inputArmed = false;
  let timerIds = [];

  function textContent() {
    return (composer.innerText || '').replace(/\u00a0/g, ' ').trim();
  }

  function syncMirror() {
    mirror.value = textContent();
  }

  function syncEmptyState() {
    const hasTurns = thread.children.length > 0;
    if (emptyHero) emptyHero.hidden = hasTurns;
    thread.hidden = !hasTurns;
    const stage = document.querySelector('.main-stage');
    if (stage) stage.classList.toggle('is-empty', !hasTurns);
  }

  function updateComposerUi() {
    const hasText = inputArmed && textContent().length > 0;
    if (streaming) {
      sendBtn.hidden = true;
      sendBtn.disabled = true;
      voiceBtn.hidden = true;
      if (thinkBtn) thinkBtn.hidden = true;
      if (micBtn) micBtn.hidden = true;
      stopBtn.hidden = false;
      return;
    }
    stopBtn.hidden = true;
    if (thinkBtn) thinkBtn.hidden = false;
    if (micBtn) micBtn.hidden = false;
    if (hasText) {
      voiceBtn.hidden = true;
      sendBtn.hidden = false;
      sendBtn.disabled = false;
    } else {
      sendBtn.hidden = true;
      sendBtn.disabled = true;
      voiceBtn.hidden = false;
    }
  }

  function clearTimers() {
    for (const id of timerIds) clearTimeout(id);
    timerIds = [];
  }

  function appendTurn(role, html) {
    const turn = document.createElement('div');
    turn.className = 'turn';
    turn.setAttribute('data-message-author-role', role);
    if (role === 'user') {
      turn.innerHTML = `<div class="bubble">${escapeHtml(html)}</div>`;
    } else {
      turn.innerHTML = `<div class="markdown prose"></div>`;
      turn.querySelector('.markdown.prose').textContent = html;
    }
    thread.appendChild(turn);
    syncEmptyState();
    return turn;
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cannedReply(prompt) {
    return `Mock reply to: ${prompt}`;
  }

  async function streamAssistant(fullText) {
    streaming = true;
    stopRequested = false;
    updateComposerUi();
    const turn = appendTurn('assistant', '');
    const body = turn.querySelector('.markdown.prose');
    const chunkCount = Math.max(8, Math.min(40, Math.ceil(fullText.length / 4)));
    const step = Math.ceil(fullText.length / chunkCount);
    const interval = delayMs / chunkCount;

    await new Promise((resolve) => {
      let i = 0;
      const tick = () => {
        if (stopRequested) {
          streaming = false;
          updateComposerUi();
          resolve();
          return;
        }
        i = Math.min(fullText.length, i + step);
        body.textContent = fullText.slice(0, i);
        thread.scrollTop = thread.scrollHeight;
        if (i >= fullText.length) {
          streaming = false;
          updateComposerUi();
          resolve();
          return;
        }
        timerIds.push(setTimeout(tick, interval));
      };
      timerIds.push(setTimeout(tick, interval));
    });
  }

  async function submitPrompt() {
    if (streaming) return;
    const prompt = textContent();
    if (!prompt || !inputArmed) return;
    appendTurn('user', prompt);
    composer.innerHTML = '';
    inputArmed = false;
    syncMirror();
    updateComposerUi();
    await streamAssistant(cannedReply(prompt));
  }

  function newChat(e) {
    if (e) e.preventDefault();
    clearTimers();
    streaming = false;
    stopRequested = false;
    inputArmed = false;
    thread.innerHTML = '';
    composer.innerHTML = '';
    syncMirror();
    syncEmptyState();
    updateComposerUi();
    composer.focus();
  }

  composer.addEventListener('input', () => {
    inputArmed = textContent().length > 0;
    syncMirror();
    updateComposerUi();
  });
  composer.addEventListener('beforeinput', () => {
    // ProseMirror-like: real editing events arm send.
  });

  composer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitPrompt();
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitPrompt();
  });

  stopBtn.addEventListener('click', () => {
    stopRequested = true;
    clearTimers();
    streaming = false;
    updateComposerUi();
  });

  document.querySelectorAll('[data-testid="create-new-chat-button"]').forEach((el) => {
    el.addEventListener('click', newChat);
  });

  // Expose for unit tests
  window.__mockChat = {
    textContent,
    updateComposerUi,
    setComposerHtmlWithoutInput(html) {
      composer.innerHTML = html;
      inputArmed = false;
      updateComposerUi();
    },
    dispatchInput() {
      inputArmed = true;
      composer.dispatchEvent(new InputEvent('input', { bubbles: true }));
      updateComposerUi();
    },
  };

  updateComposerUi();
  syncEmptyState();
})();
