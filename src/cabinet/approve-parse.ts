import type { PlanTask } from "./types.js";
import { classifyTasks } from "./policy.js";

export interface ApproveSelection {
  readonly approveAll: boolean;
  /** 1-based task numbers to include (when approveAll=false). */
  readonly includeTasks: Set<number>;
  /** 1-based task numbers to skip (when approveAll=true or explicit skip). */
  readonly excludeTasks: Set<number>;
}

const NATURAL_ALL =
  /^(yes|yeah|yep|yup|ok|okay|k|go|go ahead|do it|do that|proceed|execute|ship it|make it so|lgtm|sounds good|approved|oui|ouais|d'accord|ey|aye|wakel|oké)\.?$/i;

/** Parse owner text like "approve 1 and 3", "yes", "do it", "do 1 and 3". */
export function parseApproveSelection(text: string): ApproveSelection | null {
  const raw = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!raw) return null;

  // Explicit reject is never an approve selection
  if (/^reject\b/.test(raw)) return null;

  const includeTasks = new Set<number>();
  const excludeTasks = new Set<number>();

  for (const m of raw.matchAll(/\b(?:skip|exclude)\s*(?:task\s*)?(\d+)\b/g)) {
    excludeTasks.add(Number(m[1]));
  }
  for (const m of raw.matchAll(/\bexcept\s*(?:task\s*)?(\d+)\b/g)) {
    excludeTasks.add(Number(m[1]));
  }

  // Short president-language affirmatives (only when short — avoid "yes but also move…")
  if (raw.length <= 48 && NATURAL_ALL.test(raw)) {
    return { approveAll: true, includeTasks, excludeTasks };
  }

  // "do 1 and 3" / "run tasks 1, 2" / "1 and 3 only"
  const doNums = raw.match(
    /^(?:do|run|execute|go)\s+(?:tasks?\s+)?(.+)$/i,
  );
  if (doNums && raw.length <= 64) {
    for (const m of doNums[1]!.matchAll(/(\d+)/g)) {
      includeTasks.add(Number(m[1]));
    }
    if (includeTasks.size) {
      return { approveAll: false, includeTasks, excludeTasks };
    }
  }
  if (
    raw.length <= 32 &&
    /^\d+(\s*(?:and|,|&|\+)\s*\d+)*\s*(?:only)?\.?$/.test(raw)
  ) {
    for (const m of raw.matchAll(/(\d+)/g)) {
      includeTasks.add(Number(m[1]));
    }
    if (includeTasks.size) {
      return { approveAll: false, includeTasks, excludeTasks };
    }
  }

  // Legacy approve / skip language
  if (!/(^|\s)(approve|skip|exclude)/.test(raw)) return null;

  const approveAll = /\bapprove\s*all\b/.test(raw) || raw === "approve";

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
