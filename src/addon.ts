import { config } from "../package.json";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import type { TaskRecord } from "./modules/tasks";
import type { KeyboardCallback } from "./modules/shortcuts";
import type { LocalizationLike } from "./utils/locale";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized: boolean;
    ztoolkit: ZToolkit;
    locale?: LocalizationLike;
    menuIDs: string[];
    tasks: TaskRecord[];
    activeProcesses: Map<string, any>;
    taskRunnerActive: boolean;
    taskManagerWindow: Window | null;
    taskManagerSelectedTaskID: string;
    shortcutCallback: KeyboardCallback | null;
  };

  public hooks: typeof hooks;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      ztoolkit: createZToolkit(),
      menuIDs: [],
      tasks: [],
      activeProcesses: new Map(),
      taskRunnerActive: false,
      taskManagerWindow: null,
      taskManagerSelectedTaskID: "",
      shortcutCallback: null
    };
    this.hooks = hooks;
  }
}

export default Addon;
