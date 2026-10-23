/* MilkDrop backgrounds powered by pinned, locally hosted Butterchurn assets. */
'use strict';

class StageVisualizer {
  constructor({ stage, canvas, audio, sourceKind, playing, store, directAudio }) {
    Object.assign(this, { stage, canvas, audio, sourceKind, playing, store, directAudio });
    this.controls = document.querySelector('#vizControls');
    this.select = document.querySelector('#vizPreset');
    this.status = document.querySelector('#vizStatus');
    this.shareButton = document.querySelector('#vizAudio');
    this.shareHint = document.querySelector('#vizCaptureHint');
    this.captureVersion = 0;
    this.auto = document.querySelector('#vizAuto');
    this.auto.checked = store.get('gkc.vizAuto', true);
    this.auto.addEventListener('change', () => store.set('gkc.vizAuto', this.auto.checked));
    this.select.addEventListener('change', () => this.loadPreset(this.select.value));
    document.querySelector('#vizShuffle').addEventListener('click', () => this.shuffle());
    this.shareButton.addEventListener('click', () => {
      if (this.directAudio && this.directAudio.available && this.sourceKind() === 'yt') this.directAudio.retry();
      else if (this.stream) this.stopCapture();
      else this.capture();
    });
    this.frame = this.frame.bind(this);
    new ResizeObserver(() => this.resize()).observe(stage);
    document.addEventListener('visibilitychange', () => {
      cancelAnimationFrame(this.raf);
      if (this.enabled && !this.failed && !document.hidden && this.engine) this.raf = requestAnimationFrame(this.frame);
    });
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.fail('The visualizer lost its graphics connection. Switch backgrounds to retry.');
    });
    canvas.addEventListener('webglcontextrestored', () => { this.connect(null); this.engine = null; });
    window.addEventListener('pagehide', () => this.stopCapture());
  }

  loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => { script.remove(); reject(new Error('Could not load visualizer assets.')); };
      document.head.append(script);
    });
  }

  async init() {
    if (this.engine) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      await Promise.all([
        window.butterchurn ? null : this.loadScript('vendor/butterchurn-2.6.7.min.js'),
        window.butterchurnPresets ? null : this.loadScript('vendor/butterchurn-presets-2.4.7.min.js'),
        window.butterchurnPresetsExtra ? null : this.loadScript('vendor/butterchurn-presets-extra-2.4.7.min.js'),
        window.butterchurnPresetsExtra2 ? null : this.loadScript('vendor/butterchurn-presets-extra2-2.4.7.min.js'),
      ]);
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('This browser does not support audio visualizers.');
      this.context = this.context || new AudioContext();
      this.engine = window.butterchurn.default.createVisualizer(this.context, this.canvas, { width: 800, height: 600, pixelRatio: 1 });
      this.presets = { ...window.butterchurnPresets.getPresets(), ...window.butterchurnPresetsExtra.getPresets(),
        ...window.butterchurnPresetsExtra2.getPresets() };
      this.names = Object.keys(this.presets).sort();
      this.select.replaceChildren(...this.names.map((name) => new Option(name, name)));
      this.select.disabled = false;
      document.querySelector('#vizShuffle').disabled = false;
      const saved = this.store.get('gkc.vizPreset', '');
      this.loadPreset(this.presets[saved] ? saved : this.names[Math.floor(Math.random() * this.names.length)], 0);
      this.resize();
    })();
    try { await this.loading; } finally { this.loading = null; }
  }

  async setEnabled(enabled) {
    this.enabled = enabled;
    this.failed = false;
    this.controls.hidden = !enabled;
    cancelAnimationFrame(this.raf);
    this.canvas.hidden = !enabled;
    this.stage.classList.toggle('visualizing', enabled);
    if (!enabled) {
      this.stopCapture();
      return;
    }
    this.status.textContent = 'Loading MilkDrop presets…';
    // Resume synchronously from the click when an audio context already exists.
    if (this.context) this.context.resume().catch(() => {});
    try {
      await this.init();
      if (!this.enabled) return;
      this.canvas.hidden = false;
      this.stage.classList.add('visualizing');
      this.sourceChanged();
      this.context.resume().catch(() => {});
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.frame);
    } catch (e) { if (this.enabled) this.fail(`${e.message} Try a browser with WebGL 2 enabled.`); }
  }

  fail(message) {
    this.failed = true;
    cancelAnimationFrame(this.raf);
    this.stopCapture();
    this.canvas.hidden = true;
    this.stage.classList.remove('visualizing');
    this.status.textContent = message;
  }

  resize() {
    if (!this.engine || !this.enabled) return;
    const { width, height } = this.stage.getBoundingClientRect();
    // Cap resolution for smooth backgrounds on TVs and phones alike.
    const scale = Math.min(window.devicePixelRatio || 1, 1.5, 1600 / Math.max(width, 1));
    const renderWidth = Math.max(1, Math.round(width * scale));
    const renderHeight = Math.max(1, Math.round(height * scale));
    // Butterchurn 2.x resizes its textures but leaves the output canvas alone.
    // Its drawing buffer must match, otherwise fullscreen clips the viewport.
    if (this.canvas.width === renderWidth && this.canvas.height === renderHeight) return;
    this.canvas.width = renderWidth;
    this.canvas.height = renderHeight;
    this.engine.setRendererSize(renderWidth, renderHeight);
  }

  loadPreset(name, blend = 2) {
    if (!this.presets || !this.presets[name]) return;
    try {
      this.engine.loadPreset(this.presets[name], blend);
      this.select.value = name;
      this.store.set('gkc.vizPreset', name);
      this.presetAt = performance.now();
    } catch (e) { this.status.textContent = `This preset could not load. Choose another. ${e.message}`; }
  }

  shuffle() {
    if (!this.names || this.names.length < 2) return;
    const choices = this.names.filter((name) => name !== this.select.value);
    this.loadPreset(choices[Math.floor(Math.random() * choices.length)]);
  }

  sourceChanged() {
    if (!this.enabled || !this.engine) return;
    if (['file', 'direct'].includes(this.sourceKind())) {
      this.stopCapture(false);
      // A media element can have only one source node, even across file changes.
      if (!this.fileNode) {
        this.fileNode = this.context.createMediaElementSource(this.audio);
        this.fileNode.connect(this.context.destination);
        this.audio.addEventListener('play', () => this.context.resume().catch(() => {}));
      }
      this.connect(this.fileNode);
    } else {
      this.connect(this.captureNode || null);
    }
    this.describeAudio();
  }

  connect(node) {
    if (node === this.connected) return;
    if (this.connected) this.engine.disconnectAudio(this.connected);
    this.connected = node;
    if (node) this.engine.connectAudio(node);
  }

  describeAudio() {
    const source = this.sourceKind();
    const file = source === 'file' || source === 'direct';
    const direct = this.directAudio;
    const firefox = /Firefox\/|FxiOS\//.test(navigator.userAgent || '');
    const preparing = source === 'yt' && direct && direct.available;
    this.shareButton.hidden = file || (firefox && !preparing);
    this.shareButton.disabled = !!(preparing && !direct.error);
    this.shareHint.hidden = file || !!this.stream || !!preparing;
    this.shareButton.textContent = this.stream ? 'Disconnect tab audio' : 'Connect tab audio…';
    if (preparing) this.shareButton.textContent = direct.error ? 'Retry song audio' : 'Preparing song audio…';
    if (firefox) this.shareHint.textContent = 'Firefox cannot capture tab audio. Use the local launcher for direct song audio, or load an audio file. No screen sharing is needed.';
    this.status.textContent = file
      ? `${this.names.length} presets · ${source === 'direct' ? 'Reacting directly to the song. No screen sharing needed.' : 'Reacting to your audio file.'}`
      : preparing ? (direct.error || 'Preparing song audio for the visualizer. Playback will switch automatically; no screen sharing needed.')
      : this.stream ? `${this.names.length} presets · Reacting to shared audio.`
        : `${this.names.length} presets · Ambient motion. Connect this tab’s audio to react to YouTube, or choose another browser tab playing music.`;
  }

  async capture() {
    if (this.capturing) return;
    if (/Firefox\/|FxiOS\//.test(navigator.userAgent || '')) {
      this.status.textContent = 'Firefox cannot capture tab audio. Use the local launcher for direct song audio, or load an audio file.';
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      this.status.textContent = 'Tab audio sharing is unavailable here. Use Chrome or Edge, or load an audio file. Ambient visuals still work.';
      return;
    }
    this.capturing = true;
    const version = this.captureVersion;
    let stream;
    try {
      // This API requires video even when only audio is wanted. Prefer tabs,
      // exclude full monitors where supported, and ignore/disable all pictures.
      // Must be invoked directly by the user's click for the browser picker.
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser' },
        audio: { suppressLocalAudioPlayback: false },
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        monitorTypeSurfaces: 'exclude',
        systemAudio: 'exclude',
        surfaceSwitching: 'exclude',
      });
      if (!this.enabled || this.sourceKind() === 'file' || version !== this.captureVersion) return;
      const videoTracks = stream.getVideoTracks();
      const surface = videoTracks[0] && videoTracks[0].getSettings().displaySurface;
      videoTracks.forEach((track) => { track.enabled = false; });
      if (surface && surface !== 'browser') {
        this.status.textContent = 'Choose a browser tab with tab audio enabled. Screen and window sharing are not used.';
        return;
      }
      if (!stream.getAudioTracks().length) {
        this.status.textContent = 'No audio was shared. Try again, choose a browser tab, and enable “Share tab audio”.';
        return;
      }
      await this.init();
      await this.context.resume();
      if (!this.enabled || this.sourceKind() === 'file' || version !== this.captureVersion) return;
      this.stream = stream;
      this.captureNode = this.context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      // Only analyze shared audio; routing it to speakers would double playback.
      this.connect(this.captureNode);
      stream.getTracks().forEach((t) => t.addEventListener('ended', () => this.stopCapture(), { once: true }));
      this.describeAudio();
    } catch (e) {
      this.status.textContent = e.name === 'NotAllowedError'
        ? 'Audio sharing was cancelled. Ambient visuals still work; you can try sharing again.'
        : `Could not share audio. ${e.message}`;
    } finally {
      if (stream && this.stream !== stream) stream.getTracks().forEach((t) => t.stop());
      this.capturing = false;
    }
  }

  stopCapture(describe = true) {
    this.captureVersion++;
    if (this.captureNode && this.connected === this.captureNode) this.connect(null);
    const stream = this.stream;
    this.stream = this.captureNode = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (describe && this.enabled && this.names) this.describeAudio();
  }

  frame(now) {
    if (!this.enabled || document.hidden) return;
    // 30 fps leaves room for word timing and keeps GPU use reasonable.
    if (!this.renderAt || now - this.renderAt >= 1000 / 30) {
      this.renderAt = now;
      try {
        if (this.auto.checked && this.playing() && now - this.presetAt >= 30000) this.shuffle();
        this.engine.render();
      } catch (e) { this.fail(`The visualizer stopped. ${e.message}`); return; }
    }
    this.raf = requestAnimationFrame(this.frame);
  }
}
