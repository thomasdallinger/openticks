import Kefir, { type Observable, type Property } from 'kefir';
import type { LiveStore } from './live-store.ts';

/** A Kefir property of `select()` that re-emits whenever the store changes the selected value. */
export function watchStore<T>(store: LiveStore, select: () => T): Property<T, never> {
  return Kefir.stream<T, never>((emitter) => {
    let last: string | undefined;
    const emit = () => {
      const value = select();
      const key = JSON.stringify(value) ?? 'undefined';
      if (key === last) return;
      last = key;
      emitter.emit(value);
    };
    emit();
    return store.subscribe(emit);
  }).toProperty();
}

/** A settable Kefir property, for UI descriptors that change on user action. */
export function createValue<T>(initial: T) {
  let current = initial;
  const listeners = new Set<(value: T) => void>();
  const property = Kefir.stream<T, never>((emitter) => {
    const listener = (value: T) => emitter.emit(value);
    listeners.add(listener);
    emitter.emit(current);
    return () => listeners.delete(listener);
  }).toProperty();
  return {
    property,
    get: () => current,
    set(value: T) {
      current = value;
      for (const listener of listeners) listener(value);
    },
  };
}

/** Ends an observable when an InboxSDK view is destroyed, so its listeners are released. */
export function untilDestroyed<T>(
  observable: Observable<T, never>,
  view: { on(event: 'destroy', listener: () => void): unknown },
): Observable<T, never> {
  return observable.takeUntilBy(Kefir.fromEvents<void, never>(view as never, 'destroy'));
}
