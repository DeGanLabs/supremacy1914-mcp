import type { PlanTask } from "./types.js";
import { classifyTasks } from "./policy.js";

export interface ApproveSelection {
  readonly approveAll: boolean;
  /** 1-based task numbers to include (when approveAll=false). */
  readonly includeTasks: Set<number>;
  /** 1-based task numbers to skip (when approveAll=true or explicit skip). */
  readonly excludeTasks: Set<number>;
}

/** Parse owner text like "approve 1 and 3", "skip 2", "approve all except task 2". */
export function parseApproveSelection(text: string): ApproveSelection | null {
  const raw = text.trim().toLowerCase();
  if (!raw) return null;
  if (!/(^|\s)(approve|reject|skip|exclude)/.test(raw)) return null;
  if (/^reject\b/.test(raw)) return null;

  const approveAll = /\bapprove\s*all\b/.test(raw) || raw === "approve";
  const includeTasks = new Set<number>();
  const excludeTasks = new Set<number>();

  for (const m of raw.matchAll(/\b(?:skip|exclude)\s*(?:task\s*)?(\d+)\b/g)) {
    excludeTasks.add(Number(m[1]));
  }
  for (const m of raw.matchAll(/\bexcept\s*(?:task\s*)?(\d+)\b/g)) {
    excludeTasks.add(Number(m[1]));
  }

  if (!approveAll) {
    const approveChunk = raw.match(/\bapprove\s+(.+)/);
    if (approveChunk) {
      for (const m of approveChunk[1]!.matchAll(/(\d+)/g)) {
        includeTasks.add(Number(m[1]));
      }
    }
    if (!includeTasks.size && /\bapprove\b/.test(raw)) {
      return { approveAll: true, includeTasks, excludeTasks };
    }
  }

  return { approveAll, includeTasks, excludeTasks };
}

export function selectExecutableTasks(
  tasks: readonly PlanTask[],
  sel: ApproveSelection,
): PlanTask[] {
  const out: PlanTask[] = [];
  tasks.forEach((task, i) => {
    const taskNum = i + 1;
    const { executable } = classifyTasks([task]);
    if (!executable.length) return;
    if (sel.excludeTasks.has(taskNum)) return;
    if (sel.approveAll) {
      out.push(task);
      return;
    }
    if (sel.includeTasks.has(taskNum)) out.push(task);
  });
  return out;
}
