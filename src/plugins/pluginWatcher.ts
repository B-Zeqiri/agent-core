import * as fs from "fs";
import * as path from "path";

export interface PluginWatcher {
  close: () => void;
}

export function startPluginWatcher(opts: {
  pluginsRoot: string;
  onChange: (reason: { event: string; file?: string }) => void;
  debounceMs?: number;
}): PluginWatcher {
  const { pluginsRoot, onChange } = opts;
  const debounceMs = typeof opts.debounceMs === "number" ? opts.debounceMs : 150;

  let timer: NodeJS.Timeout | null = null;
  const trigger = (reason: { event: string; file?: string }) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => onChange(reason), debounceMs);
  };

  const watchers: fs.FSWatcher[] = [];

  const watchDir = (dirPath: string) => {
    try {
      if (!fs.existsSync(dirPath)) return;
      const w = fs.watch(dirPath, { persistent: true }, (eventType, filename) => {
        const file = typeof filename === "string" ? path.join(dirPath, filename) : undefined;
        trigger({ event: eventType, file });
      });
      watchers.push(w);
    } catch {
      // ignore watcher failures (platform quirks)
    }
  };

  // Watch root and each plugin folder. Root watcher helps detect new folders.
  watchDir(pluginsRoot);
  try {
    const entries = fs.readdirSync(pluginsRoot, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        watchDir(path.join(pluginsRoot, e.name));
      }
    }
  } catch {
    // ignore
  }

  return {
    close() {
      if (timer) clearTimeout(timer);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // ignore
        }
      }
    },
  };
}
