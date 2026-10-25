/* playback.js - replays the steps returned by the backend.
   index = -1 means "before the first step"; 0..n-1 are the backend's steps.
   Going backwards is trivial because every step is a full snapshot of the algorithm state. */
(function (global) {
  'use strict';

  class Playback {
    constructor(handlers) {
      this.steps = [];
      this.index = -1;
      this.playing = false;
      this.speed = 5;                       // 1 (slow) .. 10 (fast)
      this.timer = null;
      this.onChange = handlers.onChange || function () {};
      this.onPlayState = handlers.onPlayState || function () {};
    }

    get hasSteps() { return this.steps.length > 0; }
    get atStart() { return this.index < 0; }
    get atEnd() { return this.index >= this.steps.length - 1; }
    get delay() { return 1750 - this.speed * 155; }   // 1595ms .. 200ms

    load(steps) {
      this._stopTimer();
      this.steps = steps || [];
      this.index = -1;
      this._setPlaying(false);
      this.onChange(this.index);
    }

    clear() { this.load([]); }

    next() {
      if (!this.hasSteps || this.atEnd) { this.pause(); return false; }
      this.index += 1;
      this.onChange(this.index);
      if (this.atEnd) this.pause();
      return true;
    }

    prev() {
      if (!this.hasSteps || this.atStart) return false;
      this.pause();
      this.index -= 1;
      this.onChange(this.index);
      return true;
    }

    reset() {
      if (!this.hasSteps) return;
      this.pause();
      this.index = -1;
      this.onChange(this.index);
    }

    play() {
      if (!this.hasSteps) return;
      if (this.atEnd) { this.index = -1; this.onChange(this.index); }
      this._setPlaying(true);
      this._tick();
    }

    pause() {
      this._stopTimer();
      this._setPlaying(false);
    }

    toggle() { this.playing ? this.pause() : this.play(); }

    setSpeed(value) { this.speed = Number(value) || 5; }

    _tick() {
      if (!this.playing) return;
      this.next();
      if (this.playing) {
        this._stopTimer();
        this.timer = setTimeout(() => this._tick(), this.delay);
      }
    }

    _stopTimer() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }

    _setPlaying(flag) {
      if (this.playing !== flag) {
        this.playing = flag;
        this.onPlayState(flag);
      }
    }
  }

  global.GTV = global.GTV || {};
  global.GTV.Playback = Playback;
})(window);
