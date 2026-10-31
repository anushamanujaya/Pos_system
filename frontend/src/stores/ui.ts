import { create } from 'zustand';

const KEY = 'pos.sidebar.collapsed';
const read = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

interface UiState {
  collapsed: boolean;
  toggle: () => void;
}
export const useUi = create<UiState>((set, get) => ({
  collapsed: read(),
  toggle: () => {
    const next = !get().collapsed;
    try {
      localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    set({ collapsed: next });
  },
}));
