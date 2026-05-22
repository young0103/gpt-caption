(() => {
  'use strict';

  const DEBUG = true;
  const VERSION = 'chatgpt-auto-v20';

  function log(...args) {
    if (DEBUG) console.log('[YCS CHATGPT]', ...args);
  }

  init();

  async function init() {
    log('initialized:', VERSION);

    const job = await getPendingJob();

    if (!job || !job.prompt || !job.videoId) {
      log('No pending job.');
      return;
    }

    const ageMs = Date.now() - Number(job.createdAt || 0);

    if (ageMs > 10 * 60 * 1000) {
      log('Pending job is too old. Clearing.');
      await chrome.storage.local.remove('ycs_pending_chatgpt_job');
      return;
    }

    await waitForPageReady();
    await insertPrompt(job.prompt);

    if (job.autoSend) {
      await clickSendButton();
    } else {
      log('Manual attachment mode: prompt inserted only. Waiting for user to attach files and send manually.');
    }

    const rawText = await waitForAssistantJsonResult();

    if (!rawText) {
      log('No assistant JSON result found.');
      return;
    }

    const jsonText = extractJsonArrayText(rawText);

    if (!jsonText) {
      log('Failed to extract JSON array from assistant response.');
      return;
    }

    try {
      JSON.parse(jsonText);
    } catch (error) {
      log('Extracted text is not valid JSON:', error, jsonText.slice(0, 500));
      return;
    }

    await chrome.storage.local.set({
      ycs_translation_result: {
        videoId: job.videoId,
        rawText: jsonText,
        receivedAt: Date.now()
      }
    });

    await chrome.storage.local.remove('ycs_pending_chatgpt_job');

    if (job.autoReturn) {
      chrome.runtime.sendMessage({
        action: 'ycs_return_to_youtube',
        youtubeTabId: job.youtubeTabId,
        youtubeWindowId: job.youtubeWindowId
      });
    }
  }

  function getPendingJob() {
    return new Promise((resolve) => {
      chrome.storage.local.get('ycs_pending_chatgpt_job', (result) => {
        resolve(result.ycs_pending_chatgpt_job || null);
      });
    });
  }

  async function waitForPageReady() {
    await waitForCondition(() => Boolean(findComposer()), 30000, 300);
  }

  async function insertPrompt(prompt) {
    const composer = await waitForCondition(() => findComposer(), 30000, 300);

    if (!composer) {
      throw new Error('ChatGPT composer not found.');
    }

    log('Composer found:', composer);

    setComposerText(composer, prompt);

    await sleep(800);
  }

  async function clickSendButton() {
    const sendButton = await waitForCondition(() => findSendButton(), 15000, 300);

    if (!sendButton) {
      throw new Error('Send button not found or not enabled.');
    }

    log('Clicking send button:', sendButton);
    sendButton.click();
  }

  function findComposer() {
    return (
      document.querySelector('#prompt-textarea') ||
      document.querySelector('[data-testid="prompt-textarea"]') ||
      document.querySelector('textarea') ||
      document.querySelector('[contenteditable="true"]')
    );
  }

  function setComposerText(composer, text) {
    composer.focus();

    if (composer.tagName === 'TEXTAREA') {
      composer.value = text;
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      composer.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    if (composer.isContentEditable || composer.getAttribute('contenteditable') === 'true') {
      composer.textContent = '';

      const selection = window.getSelection();
      const range = document.createRange();

      range.selectNodeContents(composer);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);

      document.execCommand('insertText', false, text);

      composer.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      }));

      return;
    }

    composer.textContent = text;
    composer.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function findSendButton() {
    const selectors = [
      'button[data-testid="send-button"]',
      'button[data-testid="composer-send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="전송"]'
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);

      if (isClickableButton(button)) return button;
    }

    const buttons = Array.from(document.querySelectorAll('button'));

    return buttons.find((button) => {
      const label = [
        button.getAttribute('aria-label') || '',
        button.getAttribute('data-testid') || '',
        button.innerText || ''
      ].join(' ');

      return isClickableButton(button) && /send|전송/i.test(label);
    }) || null;
  }

  function isClickableButton(button) {
    if (!button) return false;
    if (button.disabled) return false;
    if (button.getAttribute('aria-disabled') === 'true') return false;

    const rect = button.getBoundingClientRect();
    const style = window.getComputedStyle(button);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  }

  async function waitForAssistantJsonResult() {
    log('Waiting for assistant JSON result...');

    let lastText = '';
    let stableCount = 0;
    let parsedOnce = false;

    for (let i = 0; i < 360; i += 1) {
      await sleep(1000);

      const assistantText = getLastAssistantMessageText();

      if (assistantText && assistantText !== lastText) {
        lastText = assistantText;
        stableCount = 0;
        log('Assistant text updated. Length:', assistantText.length);
      } else if (assistantText && assistantText === lastText) {
        stableCount += 1;
      }

      const jsonText = extractJsonArrayText(lastText);
      const generating = isGenerating();

      if (jsonText) {
        try {
          JSON.parse(jsonText);
          parsedOnce = true;
        } catch {
          parsedOnce = false;
        }
      }

      if (parsedOnce && !generating && stableCount >= 5) {
        log('Assistant result looks complete.');
        return lastText;
      }
    }

    return lastText || '';
  }

  function getLastAssistantMessageText() {
    const candidates = [
      ...document.querySelectorAll('[data-message-author-role="assistant"]'),
      ...document.querySelectorAll('article')
    ];

    const visible = candidates.filter((node) => {
      const text = node.innerText || node.textContent || '';
      const rect = node.getBoundingClientRect();
      return text.trim() && rect.width > 0 && rect.height > 0;
    });

    if (!visible.length) return '';

    return visible[visible.length - 1].innerText || visible[visible.length - 1].textContent || '';
  }

  function isGenerating() {
    const buttons = Array.from(document.querySelectorAll('button'));

    const stopButton = buttons.find((button) => {
      const label = [
        button.getAttribute('aria-label') || '',
        button.innerText || '',
        button.getAttribute('data-testid') || ''
      ].join(' ');

      return /stop|중지/i.test(label);
    });

    return Boolean(stopButton);
  }

  function extractJsonArrayText(text) {
    const cleaned = stripMarkdownCodeFence(String(text || '').trim());
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');

    if (start === -1 || end === -1 || end <= start) {
      return '';
    }

    return cleaned.slice(start, end + 1).trim();
  }

  function stripMarkdownCodeFence(text) {
    return text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();
  }

  function waitForCondition(callback, timeoutMs, intervalMs) {
    return new Promise((resolve) => {
      const startedAt = Date.now();

      const timer = window.setInterval(() => {
        let value = null;

        try {
          value = callback();
        } catch {
          value = null;
        }

        if (value) {
          window.clearInterval(timer);
          resolve(value);
          return;
        }

        if (Date.now() - startedAt > timeoutMs) {
          window.clearInterval(timer);
          resolve(null);
        }
      }, intervalMs);
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }
})();