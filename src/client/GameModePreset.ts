export type MenuGameModePreset = "normal" | "fast";

const STORAGE_KEY = "menu_game_mode_preset";

export function loadMenuGameModePreset(): MenuGameModePreset {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "fast" ? "fast" : "normal";
}

export function saveMenuGameModePreset(preset: MenuGameModePreset): void {
  localStorage.setItem(STORAGE_KEY, preset);
}

