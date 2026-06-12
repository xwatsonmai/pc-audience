import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, AppState, DanmakuMessage } from "../shared/types";

const api = {
  getState: (): Promise<AppState> => ipcRenderer.invoke("app:get-state"),
  updateSettings: (patch: Partial<AppSettings>): Promise<AppState> =>
    ipcRenderer.invoke("app:update-settings", patch),
  setTodayTask: (taskText: string): Promise<AppState> => ipcRenderer.invoke("app:set-task", taskText),
  togglePaused: (paused: boolean): Promise<AppState> =>
    ipcRenderer.invoke("app:toggle-paused", paused),
  observeNow: (): Promise<AppState> => ipcRenderer.invoke("app:observe-now"),
  setOverlayActivity: (activeCount: number): void => {
    ipcRenderer.send("overlay:activity", activeCount);
  },
  onState: (callback: (state: AppState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AppState) => callback(state);
    ipcRenderer.on("app:state", listener);
    return () => {
      ipcRenderer.removeListener("app:state", listener);
    };
  },
  onDanmaku: (callback: (messages: DanmakuMessage[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, messages: DanmakuMessage[]) =>
      callback(messages);
    ipcRenderer.on("danmaku:push", listener);
    return () => {
      ipcRenderer.removeListener("danmaku:push", listener);
    };
  },
};

contextBridge.exposeInMainWorld("audience", api);

export type AudienceApi = typeof api;
