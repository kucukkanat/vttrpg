/**
 * Minimal fake Web Audio for tests: records scheduled parameter automation and node lifecycle,
 * implements just enough of the API that the engine, synths and ambiences build their graphs.
 */

export interface ParamCall { method: string; args: number[] }

export class FakeParam {
  calls: ParamCall[] = []
  constructor(public value = 0) {}
  private rec(method: string, ...args: number[]) { this.calls.push({ method, args }); return this }
  setValueAtTime(v: number, t: number) { this.value = v; return this.rec('setValueAtTime', v, t) }
  linearRampToValueAtTime(v: number, t: number) { this.value = v; return this.rec('linearRampToValueAtTime', v, t) }
  exponentialRampToValueAtTime(v: number, t: number) { this.value = v; return this.rec('exponentialRampToValueAtTime', v, t) }
  setTargetAtTime(v: number, t: number, tc: number) { this.value = v; return this.rec('setTargetAtTime', v, t, tc) }
  cancelScheduledValues(t: number) { return this.rec('cancelScheduledValues', t) }
}

export class FakeNode {
  connections: (FakeNode | FakeParam)[] = []
  disconnected = false
  started: number[] = []
  stopped: number[] = []
  constructor(public ctx: FakeAudioContext, public type: string) { ctx.nodes.push(this) }
  connect(dest: FakeNode | FakeParam) { this.connections.push(dest); return dest }
  disconnect() { this.disconnected = true; this.connections = [] }
  start(when = this.ctx.currentTime) { this.started.push(when) }
  stop(when = this.ctx.currentTime) { this.stopped.push(when) }
  addEventListener() {}
  removeEventListener() {}
}

export class FakeGain extends FakeNode { gain = new FakeParam(1); constructor(ctx: FakeAudioContext) { super(ctx, 'gain') } }
export class FakeBufferSource extends FakeNode {
  buffer: FakeBuffer | null = null
  loop = false
  loopStart = 0
  playbackRate = new FakeParam(1)
  constructor(ctx: FakeAudioContext) { super(ctx, 'bufferSource') }
}
export class FakeOscillator extends FakeNode {
  type2: string = 'sine'
  frequency = new FakeParam(440)
  detune = new FakeParam(0)
  constructor(ctx: FakeAudioContext) { super(ctx, 'oscillator') }
}
export class FakeFilter extends FakeNode {
  frequency = new FakeParam(350)
  Q = new FakeParam(1)
  constructor(ctx: FakeAudioContext) { super(ctx, 'filter') }
}
export class FakeDelay extends FakeNode { delayTime = new FakeParam(0); constructor(ctx: FakeAudioContext) { super(ctx, 'delay') } }
export class FakeShaper extends FakeNode { curve: Float32Array | null = null; constructor(ctx: FakeAudioContext) { super(ctx, 'shaper') } }

export class FakeBuffer {
  private data: Float32Array[]
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length))
  }
  get duration() { return this.length / this.sampleRate }
  getChannelData(c: number) { return this.data[c] }
}

export class FakeAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended'
  currentTime = 0
  sampleRate = 48000
  nodes: FakeNode[] = []
  destination = new FakeNode(this, 'destination')
  resumes = 0
  decoded = 0
  private listeners = new Set<() => void>()
  constructor(opts?: { state?: 'suspended' | 'running'; failResume?: boolean }) {
    if (opts?.state) this.state = opts.state
    this.failResume = opts?.failResume ?? false
  }
  private failResume: boolean
  async resume() {
    this.resumes++
    if (this.failResume) throw new Error('NotAllowedError')
    this.state = 'running'
    this.emit()
  }
  async suspend() { this.state = 'suspended'; this.emit() }
  async close() { this.state = 'closed'; this.emit() }
  /** Simulate an OS interruption (phone call) and report it like a real context. */
  interrupt() { this.state = 'suspended'; this.emit() }
  private emit() { for (const l of this.listeners) l() }
  addEventListener(_t: string, l: () => void) { this.listeners.add(l) }
  removeEventListener(_t: string, l: () => void) { this.listeners.delete(l) }
  createGain() { return new FakeGain(this) }
  createBufferSource() { return new FakeBufferSource(this) }
  createOscillator() { return new FakeOscillator(this) }
  createBiquadFilter() { return new FakeFilter(this) }
  createDelay() { return new FakeDelay(this) }
  createWaveShaper() { return new FakeShaper(this) }
  createBuffer(ch: number, len: number, rate: number) { return new FakeBuffer(ch, len, rate) }
  async decodeAudioData(buf: ArrayBuffer) { this.decoded++; return new FakeBuffer(1, Math.max(1, buf.byteLength), this.sampleRate) }
  of<T extends FakeNode>(type: string): T[] { return this.nodes.filter((n) => n.type === type) as T[] }
}

export const asAudioContext = (c: FakeAudioContext): AudioContext => c as unknown as AudioContext
