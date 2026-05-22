(() => {
  'use strict';

  console.log('[YCS TEST] content.js loaded', new Date().toISOString(), location.href);

  const APP_ID = 'ycs-panel';
  const LAUNCHER_ID = 'ycs-launcher';
  const TOOLBAR_ROOT_ID = 'ycs-toolbar-root';
  const OVERLAY_ID = 'ycs-subtitle-overlay';
  const MODAL_BACKDROP_ID = 'ycs-modal-backdrop';

  const STORAGE_PREFIX = 'ycs:';
  const OVERLAY_POSITION_KEY = 'ycs:subtitle-overlay-position';
  const SUBTITLE_SETTINGS_KEY = 'ycs:subtitle-settings';
  const PROMPT_OPTIONS_KEY = 'ycs:prompt-options';

  const DEBUG = true;
  const VERSION = 'GC.ver20';

  const state = {
    videoId: null,
    title: '',
    transcript: null,
    translatedCues: null,
    subtitlesVisible: true,
    syncTimer: null,
    lastUrl: location.href
  };

  init();

  function debugLog(...args) {
    if (DEBUG) console.log('[YCS DEBUG]', ...args);
  }

  function init() {
    debugLog('Extension initialized:', VERSION);

    ensurePanel();
    refreshPageState();
    startUrlWatcher();
    startSubtitleSync();
    listenForChatGptResult();
    checkStoredChatGptResult();

    window.addEventListener('focus', checkStoredChatGptResult);
    document.addEventListener('visibilitychange', checkStoredChatGptResult);

    window.addEventListener('yt-navigate-finish', () => {
      window.setTimeout(refreshPageState, 300);
      window.setTimeout(refreshPageState, 1000);
      window.setTimeout(refreshPageState, 2500);
    });
  }

  function startUrlWatcher() {
    window.setInterval(() => {
      if (state.lastUrl !== location.href) {
        state.lastUrl = location.href;
        refreshPageState();
      }

      mountLauncherToToolbarRoot();
    }, 800);
  }

  function refreshPageState() {
    state.videoId = getVideoId();
    state.title = getVideoTitle();
    state.transcript = loadJson(storageKey('transcript'));
    state.translatedCues = loadJson(storageKey('translation'));

    getPromptOptions();

    ensurePanel();
    mountLauncherToToolbarRoot();

    const panel = document.getElementById(APP_ID);
    const launcher = document.getElementById(LAUNCHER_ID);
    const toolbarRoot = document.getElementById(TOOLBAR_ROOT_ID);

    if (panel) {
      panel.classList.toggle('ycs-hidden-on-page', !isWatchPage());
      updatePanelVideoInfo();
      setStatus(state.videoId ? buildInitialStatus() : 'Open a YouTube watch page first.');
    }

    if (launcher) {
      launcher.classList.toggle('ycs-hidden-on-page', !isWatchPage());
    }

    if (toolbarRoot) {
      toolbarRoot.classList.toggle('ycs-hidden-on-page', !isWatchPage());
    }

    ensureSubtitleOverlay();
    renderActiveSubtitle();
  }

  function ensurePanel() {
    let launcher = document.getElementById(LAUNCHER_ID);

    if (!launcher) {
      launcher = document.createElement('button');
      launcher.id = LAUNCHER_ID;
      launcher.type = 'button';
      launcher.className = 'ytp-button ycs-player-button';
      launcher.title = 'GC.ver20';
      launcher.setAttribute('aria-label', 'GC.ver20');
      launcher.textContent = 'GC';

      launcher.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        const panel = document.getElementById(APP_ID);
        if (!panel) return;

        panel.classList.toggle('ycs-panel-open');
      });

      document.documentElement.appendChild(launcher);
    }

    if (!document.getElementById(APP_ID)) {
      const panel = document.createElement('div');
      panel.id = APP_ID;
      panel.innerHTML = `
        <div class="ycs-title-row">
          <div class="ycs-title">GC.ver20</div>
          <button type="button" class="ycs-close" data-ycs-action="close-panel">×</button>
        </div>

        <div class="ycs-video" data-ycs-video-info>Detecting video...</div>

        <div class="ycs-button-row">
          <div class="ycs-split-action">
            <button type="button" class="ycs-main-action" data-ycs-action="extract-and-send">
              Translate with GPT
            </button>
            <button type="button" class="ycs-plus-action" data-ycs-action="edit-prompt-options" title="Prompt options">
              +
            </button>
          </div>

          <button type="button" data-ycs-action="load-translation-json">Load Transcription</button>
          <button type="button" data-ycs-action="toggle-subtitles">Show/Hide Subtitles</button>
          <div class="ycs-split-action ycs-half-action">
            <button type="button" class="ycs-danger" data-ycs-action="clear-cache">
              Clear
            </button>
            <button type="button" class="ycs-save" data-ycs-action="save-translation-json">
              Save
            </button>
          </div>
        </div>
        <div class="ycs-control-group">
          <label class="ycs-range-label">
            <span>Subtitle Size</span>
            <span data-ycs-font-size-value></span>
          </label>
          <input
            type="range"
            min="16"
            max="44"
            step="1"
            data-ycs-setting="fontSize"
          />

          <label class="ycs-range-label">
            <span>Background Opacity</span>
            <span data-ycs-bg-opacity-value></span>
          </label>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            data-ycs-setting="backgroundOpacity"
          />
        </div>
      `;

      panel.addEventListener('click', onPanelClick);
      panel.addEventListener('input', onPanelInput);

      const player = getPlayerContainer() || document.documentElement;
      player.appendChild(panel);
    }

    mountLauncherToToolbarRoot();
    syncSubtitleSettingControls();
  }

  function mountLauncherToToolbarRoot() {
    const launcher = document.getElementById(LAUNCHER_ID);
    if (!launcher) return;

    if (!isWatchPage()) {
      launcher.classList.add('ycs-hidden-on-page');
      return;
    }

    launcher.classList.remove('ycs-hidden-on-page');

    const rightControls = document.querySelector('.html5-video-player .ytp-right-controls');

    if (!rightControls) {
      window.setTimeout(mountLauncherToToolbarRoot, 500);
      return;
    }

    let root = document.getElementById(TOOLBAR_ROOT_ID);

    if (!root) {
      root = document.createElement('div');
      root.id = TOOLBAR_ROOT_ID;
      root.className = 'ycs-toolbar-root';
    }

    if (root.parentElement !== rightControls) {
      rightControls.insertBefore(root, rightControls.firstChild);
    } else if (root !== rightControls.firstChild) {
      rightControls.insertBefore(root, rightControls.firstChild);
    }

    if (launcher.parentElement !== root) {
      root.appendChild(launcher);
    }

    launcher.classList.add('ycs-in-player-controls');
  }

  async function onPanelClick(event) {
    const button = event.target.closest('button[data-ycs-action]');
    if (!button) return;

    try {
      state.videoId = getVideoId();
      state.title = getVideoTitle();

      switch (button.dataset.ycsAction) {
        case 'extract-and-send':
          await handleExtractAndSendToChatGPT();
          break;

        case 'edit-prompt-options':
          openPromptOptionsModal();
          break;

        case 'load-translation-json':
          openPasteModal();
          break;

        case 'toggle-subtitles':
          state.subtitlesVisible = !state.subtitlesVisible;
          ensureSubtitleOverlay();
          renderActiveSubtitle();
          setStatus(state.subtitlesVisible ? 'Subtitles are visible.' : 'Subtitles are hidden.');
          break;

        case 'clear-cache':
          handleClearCache();
          break;
        
        case 'save-translation-json':
          handleSaveTranslationJson();
          break;
        
        case 'close-panel':
          document.getElementById(APP_ID)?.classList.remove('ycs-panel-open');
          break;

        default:
          break;
      }
    } catch (error) {
      console.error('[YCS]', error);
      setStatus(`Error: ${error.message}`);
    }
  }

  async function handleExtractAndSendToChatGPT() {
    await handleGetTranscript();
    await handleSendToChatGPT();
  }

  async function handleGetTranscript() {
    assertVideoPage();

    setStatus('Fetching transcript...');

    const result = await extractTranscript();

    if (!result || !Array.isArray(result.cues) || !result.cues.length) {
      throw new Error('No transcript cues found. Try manually turning on YouTube CC once, wait 1-2 seconds, then click again.');
    }

    state.transcript = {
      videoId: state.videoId,
      title: state.title,
      source: result.source,
      languageCode: result.languageCode || null,
      languageName: result.languageName || null,
      cues: result.cues
    };

    saveJson(storageKey('transcript'), state.transcript);
  }

  async function handleSendToChatGPT() {
    assertVideoPage();

    state.transcript = state.transcript || loadJson(storageKey('transcript'));

    if (!state.transcript || !Array.isArray(state.transcript.cues) || !state.transcript.cues.length) {
      throw new Error('No transcript is cached yet.');
    }

    const prompt = buildGptPrompt(state.transcript);
    const promptOptions = getPromptOptions();
    const autoSend = !promptOptions.manualAttachmentMode;

    await navigator.clipboard.writeText(prompt);

    setStatus(
      autoSend
        ? 'Opening ChatGPT, auto-pasting, and auto-sending...'
        : 'Opening ChatGPT and auto-pasting only. Attach files manually, then send in ChatGPT.'
    );

    chrome.runtime.sendMessage(
      {
        action: 'ycs_open_chatgpt',
        prompt,
        videoId: state.videoId,
        autoSend
      },
      (response) => {
        debugLog('open ChatGPT response:', response);
      }
    );
  }

  async function extractTranscript() {
    debugLog('extractTranscript start');

    const tracks = await getCaptionTracksByYoutubeSummaryStyle(state.videoId);
    const autoGeneratedTrack = chooseAutoGeneratedCaptionTrack(tracks);

    const potTimedTextUrl = await ensureYouTubeCcEnabledAndWaitForPotUrl(state.videoId);

    if (potTimedTextUrl && autoGeneratedTrack?.baseUrl) {
      const autoGeneratedPotUrl = buildTimedTextUrlUsingPotParams(
        autoGeneratedTrack.baseUrl,
        potTimedTextUrl
      );

      const cues = await fetchTimedTextJson3FromUrl(autoGeneratedPotUrl);

      if (cues.length) {
        return {
          source: 'auto-generated-captionTracks-baseUrl-with-player-pot',
          languageCode: autoGeneratedTrack.languageCode || null,
          languageName: getTrackName(autoGeneratedTrack),
          cues
        };
      }
    }

    if (potTimedTextUrl) {
      const cues = await fetchTimedTextJson3FromUrl(potTimedTextUrl);

      if (cues.length) {
        return {
          source: 'youtube-player-pot-timedtext-auto-cc',
          languageCode: getQueryParam(potTimedTextUrl, 'lang'),
          languageName: getQueryParam(potTimedTextUrl, 'lang') || null,
          cues
        };
      }
    }

    if (tracks.length) {
      const preferredTrack = chooseCaptionTrack(tracks);
      const cues = await fetchTimedTextCues(preferredTrack.baseUrl);

      if (cues.length) {
        return {
          source: 'captionTracks-timedtext-fallback',
          languageCode: preferredTrack.languageCode || null,
          languageName: getTrackName(preferredTrack),
          cues
        };
      }
    }

    const domCues = extractTranscriptFromVisibleTranscriptPanel();

    if (domCues.length) {
      return {
        source: 'manual-open-transcript-panel-dom',
        languageCode: null,
        languageName: null,
        cues: domCues
      };
    }

    return null;
  }

  async function ensureYouTubeCcEnabledAndWaitForPotUrl(videoId) {
    let url = findPotTimedTextUrlFromPerformance(videoId);

    if (url) return url;

    const ccButton = document.querySelector('.ytp-subtitles-button');

    if (!ccButton) return null;

    const isPressed = ccButton.getAttribute('aria-pressed') === 'true';

    if (!isPressed) {
      ccButton.click();
    }

    for (let i = 0; i < 25; i += 1) {
      await sleep(200);

      url = findPotTimedTextUrlFromPerformance(videoId);

      if (url) return url;
    }

    if (ccButton.getAttribute('aria-pressed') === 'true') {
      ccButton.click();
      await sleep(400);
      ccButton.click();
    } else {
      ccButton.click();
    }

    for (let i = 0; i < 25; i += 1) {
      await sleep(200);

      url = findPotTimedTextUrlFromPerformance(videoId);

      if (url) return url;
    }

    return null;
  }

  function disableYouTubeBuiltInCaptions() {
    const ccButton = document.querySelector('.ytp-subtitles-button');

    if (!ccButton) return;

    const isPressed = ccButton.getAttribute('aria-pressed') === 'true';

    if (isPressed) {
      ccButton.click();
    }
  }

  function findPotTimedTextUrlFromPerformance(videoId) {
    if (!videoId) return null;

    const urls = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((url) => {
        return (
          typeof url === 'string' &&
          url.includes('/api/timedtext') &&
          url.includes(`v=${encodeURIComponent(videoId)}`) &&
          url.includes('pot=') &&
          url.includes('fmt=json3')
        );
      });

    const englishUrl = urls
      .slice()
      .reverse()
      .find((url) => {
        const lang = getQueryParam(url, 'lang');
        return lang && lang.startsWith('en');
      });

    return englishUrl || urls.at(-1) || null;
  }

  async function fetchTimedTextJson3FromUrl(url) {
    try {
      const response = await fetch(url, { credentials: 'include' });
      const text = await response.text();

      if (!response.ok || !text.trim()) return [];

      return parseJson3Text(text);
    } catch (error) {
      console.warn('[YCS] Failed to fetch pot timedtext URL:', error);
      return [];
    }
  }

  async function getCaptionTracksByYoutubeSummaryStyle(videoId) {
    if (!videoId) return [];

    try {
      const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
      const response = await fetch(url, { credentials: 'include' });

      if (!response.ok) return [];

      const html = await response.text();

      return parseCaptionTracksByYoutubeSummaryStyle(html);
    } catch {
      return [];
    }
  }

  function parseCaptionTracksByYoutubeSummaryStyle(html) {
    try {
      const splittedHtml = html.split('"captions":');

      if (splittedHtml.length < 2) return [];

      const captionsText = splittedHtml[1]
        .split(',"videoDetails"')[0]
        .replace(/\n/g, '');

      const captionsJson = JSON.parse(captionsText);
      const captionTracks =
        captionsJson?.playerCaptionsTracklistRenderer?.captionTracks || [];

      return Array.isArray(captionTracks) ? captionTracks : [];
    } catch {
      return [];
    }
  }

  function chooseAutoGeneratedCaptionTrack(tracks) {
    return tracks.find((track) => {
      const name = getTrackName(track);

      return (
        track.kind === 'asr' &&
        (
          track.languageCode?.startsWith('en') ||
          track.vssId === 'a.en' ||
          name.includes('English') ||
          name.includes('영어')
        )
      );
    }) || tracks.find((track) => track.kind === 'asr') || null;
  }

  function chooseCaptionTrack(tracks) {
    const autoEnglish = chooseAutoGeneratedCaptionTrack(tracks);
    const exactEnglish = tracks.find((track) => getTrackName(track) === 'English');

    const english = tracks.find((track) => {
      const name = getTrackName(track);
      return (
        track.languageCode?.startsWith('en') ||
        name.includes('English') ||
        name.includes('영어')
      );
    });

    return autoEnglish || exactEnglish || english || tracks[0];
  }

  function getTrackName(track) {
    return (
      track?.name?.simpleText ||
      track?.name?.runs?.map((run) => run.text).join('') ||
      ''
    );
  }

  function buildTimedTextUrlUsingPotParams(baseUrl, potUrl) {
    const keysToCopy = [
      'potc',
      'pot',
      'xorb',
      'xobt',
      'xovt',
      'cbr',
      'cbrver',
      'c',
      'cver',
      'cplayer',
      'cos',
      'cosver',
      'cplatform'
    ];

    const params = [['fmt', 'json3']];

    for (const key of keysToCopy) {
      const value = getQueryParam(potUrl, key);

      if (value != null && value !== '') {
        params.push([key, value]);
      }
    }

    return appendQueryParamsWithoutReencoding(baseUrl, params);
  }

  function appendQueryParamsWithoutReencoding(url, params) {
    const separator = url.includes('?') ? '&' : '?';

    const query = params
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');

    return `${url}${separator}${query}`;
  }

  async function fetchTimedTextCues(baseUrl) {
    if (!baseUrl) return [];

    const candidates = [
      {
        label: 'direct',
        url: baseUrl,
        parser: parseCaptionResponseAuto
      },
      {
        label: 'json3-preserve-signature',
        url: appendQueryParamWithoutReencoding(baseUrl, 'fmt', 'json3'),
        parser: parseJson3Text
      },
      {
        label: 'srv3-preserve-signature',
        url: appendQueryParamWithoutReencoding(baseUrl, 'fmt', 'srv3'),
        parser: parseXmlTimedText
      }
    ];

    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate.url, { credentials: 'include' });
        const text = await response.text();

        if (!response.ok || !text.trim()) continue;

        const cues = candidate.parser(text);

        if (cues.length) return cues;
      } catch {
        // Try next candidate.
      }
    }

    return [];
  }

  function appendQueryParamWithoutReencoding(url, key, value) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }

  function parseCaptionResponseAuto(text) {
    const trimmed = text.trim();

    if (!trimmed) return [];

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return parseJson3Text(trimmed);
    }

    return parseXmlTimedText(trimmed);
  }

  function parseJson3Text(text) {
    try {
      const json = JSON.parse(text);
      return parseJson3TimedText(json);
    } catch {
      return [];
    }
  }

  function parseJson3TimedText(json) {
    const events = Array.isArray(json?.events) ? json.events : [];

    const cues = events
      .filter((event) => Number.isFinite(event.tStartMs) && Array.isArray(event.segs))
      .map((event) => {
        const start = event.tStartMs / 1000;
        const duration = Number.isFinite(event.dDurationMs)
          ? event.dDurationMs / 1000
          : 2.5;

        const text = event.segs
          .map((seg) => seg.utf8 || '')
          .join('')
          .replace(/\s+/g, ' ')
          .trim();

        return {
          start,
          end: start + duration,
          text
        };
      })
      .filter((cue) => cue.text);

    return fixCueEndTimes(cues);
  }

  function parseXmlTimedText(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');

    if (doc.querySelector('parsererror')) return [];

    const textNodes = Array.from(doc.querySelectorAll('text'));

    if (textNodes.length) {
      return fixCueEndTimes(
        textNodes
          .map((node) => {
            const start = Number.parseFloat(node.getAttribute('start'));
            const duration = Number.parseFloat(node.getAttribute('dur') || '2.5');
            const text = decodeHtmlEntities(node.textContent || '').replace(/\s+/g, ' ').trim();

            if (!Number.isFinite(start) || !text) return null;

            return {
              start,
              end: start + duration,
              text
            };
          })
          .filter(Boolean)
      );
    }

    const pNodes = Array.from(doc.querySelectorAll('p'));

    if (pNodes.length) {
      return fixCueEndTimes(
        pNodes
          .map((node) => {
            const startMs = Number.parseFloat(node.getAttribute('t'));
            const durationMs = Number.parseFloat(node.getAttribute('d') || '2500');
            const sNodes = Array.from(node.querySelectorAll('s'));

            const text = (sNodes.length ? sNodes : [node])
              .map((textNode) => decodeHtmlEntities(textNode.textContent || ''))
              .join('')
              .replace(/\s+/g, ' ')
              .trim();

            if (!Number.isFinite(startMs) || !text) return null;

            return {
              start: startMs / 1000,
              end: startMs / 1000 + durationMs / 1000,
              text
            };
          })
          .filter(Boolean)
      );
    }

    return [];
  }

  function extractTranscriptFromVisibleTranscriptPanel() {
    const segmentRenderers = Array.from(
      document.querySelectorAll('ytd-transcript-segment-renderer')
    );

    const cues = segmentRenderers
      .map((segment) => {
        const timeElement = segment.querySelector(
          '.segment-timestamp, [class*="timestamp"], yt-formatted-string[class*="timestamp"]'
        );

        const textElement = segment.querySelector(
          '.segment-text, yt-formatted-string.segment-text, yt-formatted-string[class*="segment-text"]'
        );

        const start = parseTimestamp(timeElement?.textContent || '');
        const text = cleanText(textElement?.textContent || '');

        if (!Number.isFinite(start) || !text) return null;

        return {
          start,
          end: start + 3,
          text
        };
      })
      .filter(Boolean);

    return dedupeAndFixTranscriptCues(cues);
  }

  function dedupeAndFixTranscriptCues(cues) {
    const seen = new Set();

    const cleaned = cues
      .filter((cue) => {
        if (!Number.isFinite(cue.start) || !cue.text) return false;

        const key = `${cue.start.toFixed(2)}:${cue.text}`;

        if (seen.has(key)) return false;

        seen.add(key);
        return true;
      })
      .sort((a, b) => a.start - b.start);

    for (let i = 0; i < cleaned.length; i += 1) {
      const nextCue = cleaned[i + 1];

      if (nextCue) {
        cleaned[i].end = Math.max(cleaned[i].start + 0.1, nextCue.start);
      } else {
        cleaned[i].end = cleaned[i].start + 3;
      }
    }

    return cleaned;
  }

  function fixCueEndTimes(cues) {
    const cleaned = cues
      .filter((cue) => {
        return (
          Number.isFinite(cue.start) &&
          Number.isFinite(cue.end) &&
          cue.end > cue.start &&
          typeof cue.text === 'string' &&
          cue.text.trim()
        );
      })
      .sort((a, b) => a.start - b.start);

    for (let i = 0; i < cleaned.length - 1; i += 1) {
      if (!Number.isFinite(cleaned[i].end) || cleaned[i].end <= cleaned[i].start) {
        cleaned[i].end = Math.max(cleaned[i].start + 0.1, cleaned[i + 1].start);
      }
    }

    return cleaned;
  }

  function buildGptPrompt(transcript) {
    const options = getPromptOptions();

    const lines = transcript.cues
      .map((cue, index) => `${index + 1}. [${cue.start.toFixed(2)} --> ${cue.end.toFixed(2)}] ${cue.text}`)
      .join('\n');

    const manualAttachmentBlock = options.manualAttachmentMode
      ? `

  Important:
  The user will manually attach one or more reference files in ChatGPT before sending this message.
  Use the attached file(s) as reference material for terminology, context, definitions, names, and translation consistency.
  Do not summarize the attached file(s). Use them only to improve the subtitle translation.`
      : '';

    const extraInstructionsBlock = options.extraInstructions.trim()
      ? `

  User-provided additional instructions:
  ${options.extraInstructions.trim()}`
      : '';

    return `You are a professional English-to-Korean subtitle translator.

  Task:
  Translate the following YouTube transcript into natural Korean subtitles with full-context awareness.

  Video title:
  ${transcript.title || state.title || '(unknown)'}

  Instructions:
  1. First infer what the whole video is about from the full transcript.
  2. Build an internal consistent terminology glossary before translating. Do not output the glossary.
  3. Translate with full-context awareness. Use the entire transcript context to keep terminology, tone, and references consistent.
  4. Translate meaning, not word-by-word. Make the Korean natural for subtitles.
  5. Do not arbitrarily omit, shorten, oversimplify, or summarize the original content.
  6. Preserve the speaker's intended meaning as much as possible, including explanations, logical flow, nuance, and technical details.
  7. If the source transcript is auto-generated and awkward, infer the most likely intended meaning from context before translating.
  8. If user-provided instructions or attached files are given, use them to improve terminology and consistency.
  9. Preserve the timing information.
  10. Keep one output cue per input cue unless a cue is empty or unusable.
  11. Return ONLY valid JSON. No Markdown, no code fence, no explanation.${manualAttachmentBlock}${extraInstructionsBlock}

  Required JSON schema:
  [
    {
      "start": 0.0,
      "end": 3.2,
      "text_ko": "Korean subtitle text"
    }
  ]

  Transcript:
  ${lines}`;
  }

  function getPromptOptions() {
    const currentVideoId = getVideoId() || '';

    const defaults = {
      extraInstructions: '',
      manualAttachmentMode: false,
      keepSettings: false,
      videoId: currentVideoId
    };

    try {
      const raw = localStorage.getItem(PROMPT_OPTIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;

      if (!parsed) return defaults;

      const keepSettings = Boolean(parsed.keepSettings);
      const savedVideoId = String(parsed.videoId || '');

      /*
        Important:
        Older saved options may not have videoId/keepSettings.
        If keepSettings is false and savedVideoId is missing or different,
        treat it as stale and clear it.
      */
      if (!keepSettings && currentVideoId && savedVideoId !== currentVideoId) {
        localStorage.removeItem(PROMPT_OPTIONS_KEY);
        return defaults;
      }

      return {
        extraInstructions: String(parsed.extraInstructions || ''),
        manualAttachmentMode: Boolean(parsed.manualAttachmentMode),
        keepSettings,
        videoId: savedVideoId || currentVideoId
      };
    } catch {
      localStorage.removeItem(PROMPT_OPTIONS_KEY);
      return defaults;
    }
  }

  function savePromptOptions(options) {
    localStorage.setItem(PROMPT_OPTIONS_KEY, JSON.stringify({
      extraInstructions: String(options.extraInstructions || ''),
      manualAttachmentMode: Boolean(options.manualAttachmentMode),
      keepSettings: Boolean(options.keepSettings),
      videoId: getVideoId() || ''
    }));
  }

  function openPromptOptionsModal() {
    if (document.getElementById(MODAL_BACKDROP_ID)) return;

    const options = getPromptOptions();

    const backdrop = document.createElement('div');
    backdrop.id = MODAL_BACKDROP_ID;
    backdrop.innerHTML = `
      <div id="ycs-modal" role="dialog" aria-modal="true" aria-label="Prompt options">
        <h2>Prompt Options</h2>
        <p>
          Add translation instructions. If you want to use a PDF or other reference file,
          enable manual attachment mode, then attach the file directly in ChatGPT before sending.
        </p>

        <label class="ycs-modal-label">Additional instructions</label>
        <textarea
          class="ycs-small-textarea"
          data-ycs-prompt-extra
          spellcheck="false"
          placeholder="Example: Use the attached paper as context. Translate technical terms consistently. Keep key mathematical terms in English when appropriate."
        ></textarea>

        <label class="ycs-checkbox-row">
          <input type="checkbox" data-ycs-manual-attachment />
          <span>I will manually attach reference files in ChatGPT</span>
        </label>

        <label class="ycs-checkbox-row">
          <input type="checkbox" data-ycs-keep-prompt-options />
          <span>Keep these settings</span>
        </label>

        <div class="ycs-modal-actions">
          <button type="button" data-ycs-modal="clear">Clear</button>
          <button type="button" data-ycs-modal="cancel">Cancel</button>
          <button type="button" data-ycs-modal="save">Save</button>
        </div>
      </div>
    `;

    const textarea = backdrop.querySelector('[data-ycs-prompt-extra]');
    const manualAttachmentCheckbox = backdrop.querySelector('[data-ycs-manual-attachment]');
    const keepSettingsCheckbox = backdrop.querySelector('[data-ycs-keep-prompt-options]');

    textarea.value = options.extraInstructions;
    manualAttachmentCheckbox.checked = options.manualAttachmentMode;
    keepSettingsCheckbox.checked = options.keepSettings;

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop || event.target.dataset.ycsModal === 'cancel') {
        backdrop.remove();
        return;
      }

      if (event.target.dataset.ycsModal === 'clear') {
        savePromptOptions({
          extraInstructions: '',
          manualAttachmentMode: false,
          keepSettings: false
        });

        backdrop.remove();
        return;
      }

      if (event.target.dataset.ycsModal === 'save') {
        savePromptOptions({
          extraInstructions: textarea.value,
          manualAttachmentMode: manualAttachmentCheckbox.checked,
          keepSettings: keepSettingsCheckbox.checked
        });

        backdrop.remove();
      }
    });

    document.documentElement.appendChild(backdrop);
    textarea.focus();
  }

  function listenForChatGptResult() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;

      const change = changes.ycs_translation_result;
      const result = change?.newValue;

      if (!result || result.videoId !== getVideoId()) return;

      applyChatGptTranslationResult(result);
    });
  }

  function checkStoredChatGptResult() {
    if (!getVideoId()) return;

    chrome.storage.local.get('ycs_translation_result', (result) => {
      const stored = result.ycs_translation_result;

      if (!stored || stored.videoId !== getVideoId()) return;

      applyChatGptTranslationResult(stored);
    });
  }

  function applyChatGptTranslationResult(result) {
    try {
      const cues = parseAndValidateTranslationJson(result.rawText || result.jsonText || '');

      state.translatedCues = cues;
      saveJson(storageKey('translation'), cues);
      state.subtitlesVisible = true;

      ensureSubtitleOverlay();
      renderActiveSubtitle();
      disableYouTubeBuiltInCaptions();

      setStatus(
        `Translation automatically applied from ChatGPT.\n` +
        `Translated cues: ${cues.length}`
      );

      chrome.storage.local.remove('ycs_translation_result');
    } catch (error) {
      console.error('[YCS] Failed to apply ChatGPT result:', error);
      setStatus(`ChatGPT result was received, but JSON parsing failed: ${error.message}`);
    }
  }

  function openPasteModal() {
    assertVideoPage();

    if (document.getElementById(MODAL_BACKDROP_ID)) return;

    const backdrop = document.createElement('div');
    backdrop.id = MODAL_BACKDROP_ID;
    backdrop.innerHTML = `
      <div id="ycs-modal" role="dialog" aria-modal="true" aria-label="Load transcription JSON">
        <h2>Load Transcription</h2>
        <p>
          Paste a translated subtitle JSON array or attach a .json file.
          Expected fields: <code>start</code>, <code>end</code>, <code>text_ko</code>.
        </p>

        <input
          type="file"
          data-ycs-json-file
          accept=".json,application/json"
        />

        <textarea spellcheck="false" placeholder='[{ "start": 0.0, "end": 3.2, "text_ko": "..." }]'></textarea>

        <div class="ycs-modal-actions">
          <button type="button" data-ycs-modal="cancel">Cancel</button>
          <button type="button" data-ycs-modal="save">Validate & Apply</button>
        </div>
      </div>
    `;

    const fileInput = backdrop.querySelector('[data-ycs-json-file]');
    const textarea = backdrop.querySelector('textarea');

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];

      if (!file) return;

      const text = await file.text();
      textarea.value = text;
    });

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop || event.target.dataset.ycsModal === 'cancel') {
        backdrop.remove();
        return;
      }

      if (event.target.dataset.ycsModal === 'save') {
        try {
          const cues = parseAndValidateTranslationJson(textarea.value);

          state.translatedCues = cues;
          saveJson(storageKey('translation'), cues);
          state.subtitlesVisible = true;

          backdrop.remove();

          ensureSubtitleOverlay();
          renderActiveSubtitle();
          disableYouTubeBuiltInCaptions();

          setStatus(`Translation JSON loaded and applied.\nTranslated cues: ${cues.length}`);
        } catch (error) {
          alert(error.message);
        }
      }
    });

    document.documentElement.appendChild(backdrop);
    textarea.focus();
  }

  function parseAndValidateTranslationJson(rawText) {
    const cleanedText = extractJsonArrayText(stripMarkdownCodeFence(rawText || ''));

    if (!cleanedText.trim()) {
      throw new Error('The JSON text is empty.');
    }

    let data;

    try {
      data = JSON.parse(cleanedText);
    } catch {
      throw new Error('Invalid JSON. Make sure the JSON array is complete.');
    }

    if (!Array.isArray(data)) {
      throw new Error('The top-level JSON value must be an array.');
    }

    const cues = data.map((item, index) => {
      const start = Number(item.start);
      const end = Number(item.end);
      const text = String(item.text_ko ?? '').trim();

      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        throw new Error(`Cue ${index + 1} has invalid start/end values.`);
      }

      if (!text) {
        throw new Error(`Cue ${index + 1} has empty text_ko.`);
      }

      return {
        start,
        end,
        text_ko: text
      };
    });

    cues.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return a.end - b.end;
    });

    return cues;
  }

  function extractJsonArrayText(text) {
    const trimmed = String(text || '').trim();
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');

    if (start === -1 || end === -1 || end <= start) {
      return trimmed;
    }

    return trimmed.slice(start, end + 1);
  }

  function stripMarkdownCodeFence(text) {
    const trimmed = text.trim();

    if (!trimmed.startsWith('```')) return trimmed;

    return trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();
  }

  function handleClearCache() {
    assertVideoPage();

    localStorage.removeItem(storageKey('translation'));

    state.translatedCues = null;

    renderActiveSubtitle();

    setStatus('Cached translation cleared for this video. Transcript cache was kept.');
  }

function handleSaveTranslationJson() {
  assertVideoPage();

  const cues = state.translatedCues || loadJson(storageKey('translation'));

  if (!Array.isArray(cues) || !cues.length) {
    alert('No translated subtitles are currently loaded.');
    return;
  }

  const videoId = getVideoId() || 'unknown-video';
  const safeTitle = sanitizeFilename(getVideoTitle() || videoId);
  const filename = `${safeTitle}_${videoId}_translation.json`;

  const jsonText = JSON.stringify(cues, null, 2);
  const blob = new Blob([jsonText], {
    type: 'application/json;charset=utf-8'
  });

  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';

  document.documentElement.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);

  setStatus(`Translation JSON saved: ${filename}`);
}

function sanitizeFilename(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'youtube_translation';
}

  function getSubtitleSettings() {
    try {
      const raw = localStorage.getItem(SUBTITLE_SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};

      return {
        fontSize: Number.isFinite(Number(parsed.fontSize)) ? Number(parsed.fontSize) : 28,
        backgroundOpacity: Number.isFinite(Number(parsed.backgroundOpacity))
          ? Number(parsed.backgroundOpacity)
          : 76
      };
    } catch {
      return {
        fontSize: 28,
        backgroundOpacity: 76
      };
    }
  }

  function saveSubtitleSettings(settings) {
    localStorage.setItem(SUBTITLE_SETTINGS_KEY, JSON.stringify(settings));
  }

  function onPanelInput(event) {
    const input = event.target.closest('input[data-ycs-setting]');
    if (!input) return;

    const settings = getSubtitleSettings();
    const key = input.dataset.ycsSetting;
    const value = Number(input.value);

    if (key === 'fontSize') {
      settings.fontSize = value;
    }

    if (key === 'backgroundOpacity') {
      settings.backgroundOpacity = value;
    }

    saveSubtitleSettings(settings);
    syncSubtitleSettingControls();

    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      applySubtitleSettings(overlay);
    }
  }

  function syncSubtitleSettingControls() {
    const panel = document.getElementById(APP_ID);
    if (!panel) return;

    const settings = getSubtitleSettings();

    const fontInput = panel.querySelector('input[data-ycs-setting="fontSize"]');
    const opacityInput = panel.querySelector('input[data-ycs-setting="backgroundOpacity"]');

    const fontValue = panel.querySelector('[data-ycs-font-size-value]');
    const opacityValue = panel.querySelector('[data-ycs-bg-opacity-value]');

    if (fontInput) fontInput.value = String(settings.fontSize);
    if (opacityInput) opacityInput.value = String(settings.backgroundOpacity);

    if (fontValue) fontValue.textContent = `${settings.fontSize}px`;
    if (opacityValue) opacityValue.textContent = `${settings.backgroundOpacity}%`;
  }

  function applySubtitleSettings(overlay) {
    const settings = getSubtitleSettings();

    overlay.style.fontSize = `${settings.fontSize}px`;
    overlay.style.setProperty(
      '--ycs-subtitle-bg-opacity',
      String(Math.max(0, Math.min(100, settings.backgroundOpacity)) / 100)
    );
  }

  function ensureSubtitleOverlay() {
    const player = getPlayerContainer();

    if (!player) return null;

    let overlay = document.getElementById(OVERLAY_ID);

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.innerHTML = '<span class="ycs-subtitle-box"></span>';
    }

    if (overlay.parentElement !== player) {
      player.appendChild(overlay);
    }

    applySubtitleSettings(overlay);
    applySubtitleOverlayPosition(overlay);
    makeSubtitleOverlayDraggable(overlay);

    overlay.classList.toggle('ycs-subtitle-hidden', !state.subtitlesVisible);

    return overlay;
  }

  function applySubtitleOverlayPosition(overlay) {
    try {
      const raw = localStorage.getItem(OVERLAY_POSITION_KEY);
      if (!raw) return;

      const position = JSON.parse(raw);

      if (
        typeof position.xPercent !== 'number' ||
        typeof position.yPercent !== 'number'
      ) {
        return;
      }

      overlay.style.left = `${position.xPercent}%`;
      overlay.style.top = `${position.yPercent}%`;
      overlay.style.right = 'auto';
      overlay.style.bottom = 'auto';
      overlay.style.transform = 'translate(-50%, -50%)';
    } catch {
      // Ignore invalid saved position.
    }
  }

  function makeSubtitleOverlayDraggable(overlay) {
    if (overlay.dataset.ycsDraggable === 'true') return;

    overlay.dataset.ycsDraggable = 'true';

    let dragging = false;
    let pointerId = null;

    overlay.addEventListener('pointerdown', (event) => {
      dragging = true;
      pointerId = event.pointerId;

      overlay.setPointerCapture(pointerId);
      overlay.classList.add('ycs-subtitle-dragging');

      event.preventDefault();
      event.stopPropagation();
    });

    overlay.addEventListener('pointermove', (event) => {
      if (!dragging) return;

      const player = getPlayerContainer();
      if (!player) return;

      const rect = player.getBoundingClientRect();

      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      const xPercent = Math.max(0, Math.min(100, (x / rect.width) * 100));
      const yPercent = Math.max(0, Math.min(100, (y / rect.height) * 100));

      overlay.style.left = `${xPercent}%`;
      overlay.style.top = `${yPercent}%`;
      overlay.style.right = 'auto';
      overlay.style.bottom = 'auto';
      overlay.style.transform = 'translate(-50%, -50%)';

      localStorage.setItem(
        OVERLAY_POSITION_KEY,
        JSON.stringify({ xPercent, yPercent })
      );

      event.preventDefault();
      event.stopPropagation();
    });

    overlay.addEventListener('pointerup', (event) => {
      dragging = false;
      overlay.classList.remove('ycs-subtitle-dragging');

      if (pointerId != null) {
        try {
          overlay.releasePointerCapture(pointerId);
        } catch {
          // Ignore.
        }
      }

      pointerId = null;

      event.preventDefault();
      event.stopPropagation();
    });
  }

  function startSubtitleSync() {
    if (state.syncTimer) {
      window.clearInterval(state.syncTimer);
    }

    state.syncTimer = window.setInterval(renderActiveSubtitle, 120);
  }

  function renderActiveSubtitle() {
    const overlay = ensureSubtitleOverlay();

    if (!overlay) return;

    const box = overlay.querySelector('.ycs-subtitle-box');
    const video = document.querySelector('video');
    const cues = state.translatedCues || loadJson(storageKey('translation'));

    state.translatedCues = cues;

    if (!state.subtitlesVisible || !video || !Array.isArray(cues) || !cues.length) {
      box.innerHTML = '';
      overlay.classList.add('ycs-subtitle-hidden');
      return;
    }

    const currentTime = video.currentTime;
    const activeCues = getActiveSubtitleCues(cues, currentTime, 2);

    if (!activeCues.length) {
      box.innerHTML = '';
      overlay.classList.add('ycs-subtitle-hidden');
      return;
    }

    renderSubtitleLines(box, activeCues);

    overlay.classList.remove('ycs-subtitle-hidden');
  }

  function getActiveSubtitleCues(cues, currentTime, maxLines) {
    const tolerance = 0.05;

    const active = cues
      .filter((cue) => {
        return (
          Number.isFinite(cue.start) &&
          Number.isFinite(cue.end) &&
          cue.start <= currentTime + tolerance &&
          cue.end >= currentTime - tolerance
        );
      })
      .sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        return a.end - b.end;
      });

    return active.slice(-maxLines);
  }

  function renderSubtitleLines(box, cues) {
    box.innerHTML = '';

    for (const cue of cues) {
      const line = document.createElement('div');
      line.className = 'ycs-subtitle-line';
      line.textContent = cue.text_ko;
      box.appendChild(line);
    }
  }

  function getVideoId() {
    const url = new URL(location.href);

    if (url.hostname.includes('youtube.com') && url.pathname === '/watch') {
      return url.searchParams.get('v');
    }

    return null;
  }

  function getVideoTitle() {
    const titleElement = document.querySelector(
      'h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string, h1'
    );

    const title = titleElement?.textContent?.trim();

    return title || document.title.replace(/ - YouTube$/, '').trim();
  }

  function getPlayerContainer() {
    return document.querySelector('#movie_player, .html5-video-player');
  }

  function isWatchPage() {
    return Boolean(getVideoId());
  }

  function assertVideoPage() {
    if (!getVideoId()) {
      throw new Error('This action only works on a YouTube watch page.');
    }
  }

  function updatePanelVideoInfo() {
    const info = document.querySelector(`#${APP_ID} [data-ycs-video-info]`);

    if (!info) return;

    info.textContent = state.videoId
      ? `Video: ${state.title || state.videoId}`
      : 'No YouTube video detected.';
  }

  function setStatus(message) {
    const status = document.querySelector(`#${APP_ID} [data-ycs-status]`);

    if (status) {
      status.textContent = message;
    }

    debugLog('STATUS:', message);
  }

  function buildInitialStatus() {
    const transcript = state.transcript;
    const translation = state.translatedCues;
    const parts = ['Ready.'];

    if (transcript?.cues?.length) {
      parts.push(`Cached transcript: ${transcript.cues.length} cues.`);
    }

    if (translation?.length) {
      parts.push(`Cached translation: ${translation.length} cues.`);
    }

    return parts.join('\n');
  }

  function storageKey(type) {
    return `${STORAGE_PREFIX}${type}:${state.videoId || getVideoId() || 'unknown'}`;
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function loadJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function getQueryParam(url, key) {
    try {
      return new URL(url).searchParams.get(key);
    } catch {
      return null;
    }
  }

  function parseTimestamp(text) {
    const cleaned = cleanText(text);

    if (!cleaned) return Number.NaN;

    const parts = cleaned.split(':').map((part) => Number.parseFloat(part));

    if (parts.some((part) => !Number.isFinite(part))) return Number.NaN;

    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }

    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    return Number.NaN;
  }

  function cleanText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function decodeHtmlEntities(text) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }
})();