import { motion } from 'framer-motion';
import { Task } from '../App';

interface TaskOutputProps {
  task: Task;
  onRunAgain: () => void;
}

function TaskOutput({ task, onRunAgain }: TaskOutputProps) {
  const isSuccess = task.status === 'completed';

  const pickContent = (raw?: string) => {
    if (!raw) return '(empty)';
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        if (parsed.every((p) => typeof p === 'string')) return parsed.join('\n');
        return JSON.stringify(parsed, null, 2);
      }
      if (typeof parsed === 'object' && parsed !== null) {
        const keys = ['result', 'output', 'content', 'data', 'message', 'text'];
        for (const k of keys) {
          if (k in parsed) {
            const val = (parsed as any)[k];
            if (typeof val === 'string') return val;
            return JSON.stringify(val, null, 2);
          }
        }
        return JSON.stringify(parsed, null, 2);
      }
    } catch (e) {
      // not JSON; fall through
    }
    return raw;
  };

  const display = isSuccess ? pickContent(task.output) : pickContent(task.error);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex flex-col h-full space-y-3"
    >
      {/* Output */}
      <div className="bg-brand-panel border border-brand-border rounded-lg p-4 flex-1 flex flex-col overflow-hidden">
        <h3 className="text-sm font-semibold text-brand-text mb-3">
          {isSuccess ? 'Result' : 'Error'}
        </h3>
        <pre className="bg-brand-dark p-3 rounded text-xs text-brand-text flex-1 w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words">
          {display}
        </pre>
      </div>

      {/* Actions */}
      <button
        onClick={onRunAgain}
        className="px-4 py-3 bg-brand-accent text-brand-dark font-semibold rounded-lg hover:opacity-90 transition-opacity"
      >
        Run Another Task
      </button>
    </motion.div>
  );
}

export default TaskOutput;
