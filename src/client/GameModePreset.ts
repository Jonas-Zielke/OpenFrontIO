import { GameVariant } from "../core/game/Game";

export type MenuGameModePreset = GameVariant;

const STORAGE_KEY = "menu_game_mode_preset";

export function loadMenuGameModePreset(): MenuGameModePreset {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === GameVariant.Fast ? GameVariant.Fast : GameVariant.Normal;
}

export function saveMenuGameModePreset(preset: MenuGameModePreset): void {
  localStorage.setItem(STORAGE_KEY, preset);
}
