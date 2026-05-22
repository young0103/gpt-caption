'use strict';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  if (message.action === 'ycs_open_chatgpt') {
    const youtubeTabId = sender?.tab?.id ?? null;
    const youtubeWindowId = sender?.tab?.windowId ?? null;

    chrome.storage.local.set(
      {
        ycs_pending_chatgpt_job: {
          prompt: message.prompt,
          videoId: message.videoId,
          youtubeTabId,
          youtubeWindowId,
          createdAt: Date.now(),
          autoSend: message.autoSend !== false,
          autoReturn: true
        }
      },
      () => {
        chrome.tabs.create(
          {
            url: 'https://chatgpt.com/',
            active: true
          },
          (tab) => {
            sendResponse({
              ok: true,
              chatgptTabId: tab?.id ?? null
            });
          }
        );
      }
    );

    return true;
  }

  if (message.action === 'ycs_return_to_youtube') {
    const youtubeTabId = message.youtubeTabId;
    const youtubeWindowId = message.youtubeWindowId;

    if (youtubeWindowId != null) {
      chrome.windows.update(youtubeWindowId, { focused: true }, () => {
        if (youtubeTabId != null) {
          chrome.tabs.update(youtubeTabId, { active: true }, () => {
            sendResponse({ ok: true });
          });
        } else {
          sendResponse({ ok: false, reason: 'No youtubeTabId' });
        }
      });

      return true;
    }

    if (youtubeTabId != null) {
      chrome.tabs.update(youtubeTabId, { active: true }, () => {
        sendResponse({ ok: true });
      });

      return true;
    }

    sendResponse({ ok: false, reason: 'No tab info' });
    return false;
  }

  return false;
});