import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";

type RuntimeBrokerConfigWatcherOptions<T> = {
  path: string;
  load: () => Promise<T>;
  apply: (value: T) => Promise<void>;
  onError: (error: Error) => void;
  debounceMs?: number;
};

export function watchRuntimeBrokerConfig<T>(
  options: RuntimeBrokerConfigWatcherOptions<T>,
): () => void {
  const targetName = basename(options.path);
  const debounceMs = options.debounceMs ?? 100;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let loading = false;
  let pending = false;
  let closed = false;

  const reload = async () => {
    if (closed) return;
    if (loading) {
      pending = true;
      return;
    }
    loading = true;
    try {
      await options.apply(await options.load());
    } catch (error) {
      options.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      loading = false;
      if (pending && !closed) {
        pending = false;
        schedule();
      }
    }
  };
  const schedule = () => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void reload();
    }, debounceMs);
  };
  const watcher: FSWatcher = watch(dirname(options.path), (_eventType, filename) => {
    if (filename === null || filename.toString() === targetName) schedule();
  });
  watcher.on("error", (error) => options.onError(error));

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    watcher.close();
  };
}
