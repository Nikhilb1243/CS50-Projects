import { settings } from './settings';

export type Action =
  | 'light'
  | 'heavy'
  | 'block'
  | 'roll'
  | 'sprint'
  | 'jump'
  | 'drink'
  | 'interact'
  | 'lantern'
  | 'lockon'
  | 'targetLeft'
  | 'targetRight'
  | 'pause';

export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'accept' | 'back';

const KEY_BINDINGS: Record<string, Action> = {
  Space: 'roll',
  KeyC: 'jump',
  KeyR: 'drink',
  KeyE: 'interact',
  KeyF: 'lantern',
  KeyQ: 'lockon',
  Tab: 'lockon',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
};

// Standard gamepad mapping indices
const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  L3: 10,
  R3: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
};

const ROLL_TAP_TIME = 0.26;
const DEADZONE = 0.18;

function deadzone(v: number): number {
  const a = Math.abs(v);
  if (a < DEADZONE) return 0;
  return Math.sign(v) * ((a - DEADZONE) / (1 - DEADZONE));
}

/**
 * Unified keyboard / mouse / gamepad input, exposed as abstract actions.
 * Press/release edges are buffered until the next fixed simulation step
 * consumes them, so no input is lost between frames.
 */
export class Input {
  moveX = 0;
  moveY = 0;
  /** Pixel mouse delta accumulated since last consumeLook(). */
  private mouseDX = 0;
  private mouseDY = 0;
  /** Right-stick look (-1..1). */
  padLookX = 0;
  padLookY = 0;

  pointerLocked = false;
  usingGamepad = false;
  /** Set by the game so flicks / wheel switch targets only while locked on. */
  lockOnActive = false;
  /** When false, gameplay actions are ignored (menus open). */
  gameplayEnabled = false;

  private keys = new Set<string>();
  private mouseButtons = new Set<number>();
  private heavyFromMouse = false;

  private padHeld = new Set<Action>();
  private padButtonsPrev: boolean[] = [];
  private padBHeldTime = 0;
  private padStickFlickReady = true;
  private padMenuRepeat = 0;

  private pressedBuf = new Set<Action>();
  private releasedBuf = new Set<Action>();
  private menuBuf: MenuAction[] = [];
  private flickAccum = 0;
  private flickTimer = 0;

  private keyListeners = new Set<(code: string) => void>();

  constructor(private readonly canvas: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons.clear();
    });
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('contextmenu', (e) => {
      if (this.pointerLocked) e.preventDefault();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) {
        this.mouseButtons.clear();
      }
    });
    window.addEventListener('gamepadconnected', () => {
      this.usingGamepad = true;
    });
  }

  onKey(fn: (code: string) => void): void {
    this.keyListeners.add(fn);
  }

  requestPointerLock(): void {
    if (this.pointerLocked) return;
    try {
      const p = (this.canvas as HTMLCanvasElement).requestPointerLock?.() as unknown;
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => undefined);
    } catch {
      /* ignored */
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ---------------------------------------------------------------------------
  private press(a: Action): void {
    if (!this.gameplayEnabled && a !== 'pause') return;
    this.pressedBuf.add(a);
  }

  private release(a: Action): void {
    this.releasedBuf.add(a);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Tab' || e.code === 'F1' || e.code.startsWith('F') && e.code.length <= 3 && e.code !== 'F11' && e.code !== 'F12' && e.code !== 'F5') {
      if (e.code !== 'KeyF') e.preventDefault();
    }
    if (e.code === 'Space' && this.gameplayEnabled) e.preventDefault();
    this.usingGamepad = false;
    for (const l of this.keyListeners) if (!e.repeat) l(e.code);
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'Escape' || e.code === 'KeyP') this.press('pause');
    const a = KEY_BINDINGS[e.code];
    if (a) this.press(a);
    // Menu navigation keys
    if (!this.gameplayEnabled) {
      if (e.code === 'ArrowUp') this.menuBuf.push('up');
      if (e.code === 'ArrowDown') this.menuBuf.push('down');
      if (e.code === 'ArrowLeft') this.menuBuf.push('left');
      if (e.code === 'ArrowRight') this.menuBuf.push('right');
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    const a = KEY_BINDINGS[e.code];
    if (a) this.release(a);
  };

  private onMouseDown = (e: MouseEvent): void => {
    this.usingGamepad = false;
    if (!this.pointerLocked) return;
    this.mouseButtons.add(e.button);
    if (e.button === 0) {
      if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) {
        this.heavyFromMouse = true;
        this.press('heavy');
      } else {
        this.heavyFromMouse = false;
        this.press('light');
      }
    } else if (e.button === 2) {
      this.press('block');
    } else if (e.button === 1) {
      e.preventDefault();
      this.press('lockon');
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    this.mouseButtons.delete(e.button);
    if (e.button === 0) {
      if (this.heavyFromMouse) this.release('heavy');
      else this.release('light');
      this.heavyFromMouse = false;
    } else if (e.button === 2) this.release('block');
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
    if (this.lockOnActive) {
      this.flickAccum += e.movementX;
      this.flickTimer = 0.12;
      if (Math.abs(this.flickAccum) > 140) {
        this.press(this.flickAccum > 0 ? 'targetRight' : 'targetLeft');
        this.flickAccum = 0;
        this.flickTimer = 0.35; // debounce
      }
    }
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.pointerLocked || !this.lockOnActive) return;
    this.press(e.deltaY > 0 ? 'targetRight' : 'targetLeft');
  };

  // ---------------------------------------------------------------------------
  /** Called once per rendered frame: polls gamepads and refreshes axes. */
  poll(realDt: number): void {
    if (this.flickTimer > 0) {
      this.flickTimer -= realDt;
      if (this.flickTimer <= 0) this.flickAccum = 0;
    }

    // Keyboard movement
    let mx = 0;
    let my = 0;
    if (this.gameplayEnabled) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    }
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }

    this.padLookX = 0;
    this.padLookY = 0;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    if (pad) this.pollPad(pad, realDt, (x, y) => {
      if (Math.abs(x) > 0 || Math.abs(y) > 0) {
        mx = x;
        my = y;
      }
    });

    this.moveX = mx;
    this.moveY = my;
  }

  private pollPad(pad: Gamepad, realDt: number, setMove: (x: number, y: number) => void): void {
    const b = pad.buttons.map((btn) => btn.pressed || btn.value > 0.5);
    const prev = this.padButtonsPrev;
    const down = (i: number): boolean => !!b[i];
    const pressedNow = (i: number): boolean => !!b[i] && !prev[i];
    const releasedNow = (i: number): boolean => !b[i] && !!prev[i];

    const anyActivity = b.some((x) => x) || pad.axes.some((a) => Math.abs(a) > 0.3);
    if (anyActivity) this.usingGamepad = true;

    const lx = deadzone(pad.axes[0] ?? 0);
    const ly = deadzone(pad.axes[1] ?? 0);
    const rx = deadzone(pad.axes[2] ?? 0);
    const ry = deadzone(pad.axes[3] ?? 0);

    if (this.gameplayEnabled) {
      setMove(lx, -ly);
      this.padLookX = rx;
      this.padLookY = ry;

      const map: [number, Action][] = [
        [PAD.A, 'jump'],
        [PAD.X, 'drink'],
        [PAD.Y, 'interact'],
        [PAD.LB, 'block'],
        [PAD.RB, 'light'],
        [PAD.LT, 'lantern'],
        [PAD.RT, 'heavy'],
        [PAD.R3, 'lockon'],
        [PAD.UP, 'lantern'],
        [PAD.LEFT, 'targetLeft'],
        [PAD.RIGHT, 'targetRight'],
      ];
      this.padHeld.clear();
      for (const [idx, action] of map) {
        if (pressedNow(idx)) this.press(action);
        if (releasedNow(idx)) this.release(action);
        if (down(idx)) this.padHeld.add(action);
      }
      // B: tap = roll, hold = sprint
      if (down(PAD.B)) {
        this.padBHeldTime += realDt;
        if (this.padBHeldTime > ROLL_TAP_TIME) this.padHeld.add('sprint');
      } else {
        if (prev[PAD.B] && this.padBHeldTime <= ROLL_TAP_TIME) this.press('roll');
        this.padBHeldTime = 0;
      }
      if (down(PAD.L3)) this.padHeld.add('sprint');

      // Right stick flick switches lock-on target
      if (this.lockOnActive) {
        if (this.padStickFlickReady && Math.abs(rx) > 0.8) {
          this.press(rx > 0 ? 'targetRight' : 'targetLeft');
          this.padStickFlickReady = false;
        } else if (Math.abs(rx) < 0.3) this.padStickFlickReady = true;
      }
    } else {
      // Menu navigation
      this.padMenuRepeat -= realDt;
      const nav = (dir: MenuAction): void => {
        if (this.padMenuRepeat <= 0) {
          this.menuBuf.push(dir);
          this.padMenuRepeat = 0.22;
        }
      };
      if (down(PAD.UP) || ly < -0.6) nav('up');
      else if (down(PAD.DOWN) || ly > 0.6) nav('down');
      else if (down(PAD.LEFT) || lx < -0.6) nav('left');
      else if (down(PAD.RIGHT) || lx > 0.6) nav('right');
      else this.padMenuRepeat = 0;
      if (pressedNow(PAD.A)) this.menuBuf.push('accept');
      if (pressedNow(PAD.B)) this.menuBuf.push('back');
    }
    if (pressedNow(PAD.START)) this.press('pause');

    this.padButtonsPrev = b;
  }

  // ---------------------------------------------------------------------------
  pressed(a: Action): boolean {
    return this.pressedBuf.has(a);
  }

  released(a: Action): boolean {
    return this.releasedBuf.has(a);
  }

  held(a: Action): boolean {
    if (!this.gameplayEnabled) return false;
    if (this.padHeld.has(a)) return true;
    switch (a) {
      case 'light':
        return this.mouseButtons.has(0) && !this.heavyFromMouse;
      case 'heavy':
        return this.mouseButtons.has(0) && this.heavyFromMouse;
      case 'block':
        return this.mouseButtons.has(2);
      case 'sprint':
        return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      default:
        for (const [code, act] of Object.entries(KEY_BINDINGS)) if (act === a && this.keys.has(code)) return true;
        return false;
    }
  }

  /** Consume one buffered press (so it cannot fire twice). */
  consume(a: Action): boolean {
    if (this.pressedBuf.has(a)) {
      this.pressedBuf.delete(a);
      return true;
    }
    return false;
  }

  /** Clear edge buffers; call after each fixed step. */
  endStep(): void {
    this.pressedBuf.clear();
    this.releasedBuf.clear();
  }

  clearAll(): void {
    this.pressedBuf.clear();
    this.releasedBuf.clear();
    this.menuBuf.length = 0;
    this.mouseDX = this.mouseDY = 0;
  }

  consumeMenu(): MenuAction | undefined {
    return this.menuBuf.shift();
  }

  /** Returns look delta in radians for this frame (mouse + stick). */
  consumeLook(realDt: number): { x: number; y: number } {
    const s = settings.value;
    const mouseScale = 0.0022 * s.mouseSensitivity;
    const padScale = 2.6 * s.padSensitivity * realDt;
    let x = this.mouseDX * mouseScale + this.padLookX * padScale;
    let y = this.mouseDY * mouseScale + this.padLookY * padScale * 0.7;
    this.mouseDX = 0;
    this.mouseDY = 0;
    if (s.invertY) y = -y;
    return { x, y };
  }
}
