// ============================================================
// Fine-grained reactive computation graph. Replaces monolithic
// atlasAnalyse() recompute: changing one odd invalidates ONLY
// downstream nodes (calibration -> matrix -> markets -> portfolio).
// ============================================================
type Subscriber = () => void;
let activeComputation: Computed<unknown> | null = null;

export class Signal<T> {
  private subs = new Set<Subscriber>();
  constructor(private value: T) {}
  get(): T {
    if (activeComputation) this.subs.add(activeComputation.recompute);
    return this.value;
  }
  set(v: T) {
    if (Object.is(v, this.value)) return;
    this.value = v;
    [...this.subs].forEach((fn) => fn());
  }
}

export class Computed<T> {
  private cached: T | undefined;
  private dirty = true;
  private subs = new Set<Subscriber>();
  readonly recompute: Subscriber = () => {
    if (!this.dirty) {
      this.dirty = true;
      [...this.subs].forEach((fn) => fn());
    }
  };
  constructor(private fn: () => T) {}
  get(): T {
    if (activeComputation) this.subs.add(activeComputation.recompute);
    if (this.dirty) {
      const prev = activeComputation;
      setActiveComputation(this);
      try { this.cached = this.fn(); } finally { activeComputation = prev; }
      this.dirty = false;
    }
    return this.cached as T;
  }
}

function setActiveComputation(c: typeof activeComputation): void {
  activeComputation = c;
}

export const signal = <T>(v: T) => new Signal(v);
export const computed = <T>(fn: () => T) => new Computed(fn);
