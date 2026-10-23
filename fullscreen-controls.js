/* Fullscreen transport: reveal on activity, fade after a short idle period. */
'use strict';
class FullscreenControls {
  constructor(stage, controls, doc = document, idleMs = 2500) {
    Object.assign(this, { stage, controls, doc, idleMs });
    this.keyboard = false;
    this.dragging = false;
    const pointer = () => { this.keyboard = false; this.wake(); };
    stage.addEventListener('pointermove', pointer);
    stage.addEventListener('pointerdown', () => { this.dragging = true; pointer(); });
    const release = () => { this.dragging = false; this.wake(); };
    doc.addEventListener('pointerup', release);
    doc.addEventListener('pointercancel', release);
    doc.addEventListener('keydown', (event) => {
      this.keyboard = true;
      this.wake();
    }, true);
    stage.addEventListener('focusin', () => this.wake());
    doc.addEventListener('fullscreenchange', () => {
      clearTimeout(this.timer);
      stage.classList.remove('controls-idle');
      controls.inert = false;
      this.dragging = false;
      if (doc.fullscreenElement === stage) this.wake();
    });
  }

  wake() {
    if (this.doc.fullscreenElement !== this.stage) return;
    clearTimeout(this.timer);
    this.stage.classList.remove('controls-idle');
    this.controls.inert = false;
    this.timer = setTimeout(() => {
      if (this.doc.fullscreenElement !== this.stage || this.dragging) return;
      // A keyboard user must not lose the control they are operating.
      if (this.keyboard && this.controls.contains(this.doc.activeElement)) return;
      this.stage.classList.add('controls-idle');
      this.controls.inert = true;
    }, this.idleMs);
  }
}
if (typeof module !== 'undefined') module.exports = FullscreenControls;
