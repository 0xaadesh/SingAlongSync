import { createStore } from "./store";

export type Toast = {
  id: number;
  title: string;
  description?: string;
  tone?: "default" | "error";
  action?: { label: string; onClick: () => void };
};

export const toastStore = createStore<Toast[]>([]);

let nextId = 1;

export function toast(t: Omit<Toast, "id">) {
  const id = nextId++;
  // Keep at most three visible; the oldest drops off.
  toastStore.set((prev) => [...prev.slice(-2), { ...t, id }]);
  return id;
}

export function dismissToast(id: number) {
  toastStore.set((prev) => prev.filter((t) => t.id !== id));
}
