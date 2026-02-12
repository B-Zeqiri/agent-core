import { motion, AnimatePresence } from 'framer-motion';

type StepStatus = 'pending' | 'active' | 'done' | 'error';

interface TaskTimelineProps {
  status: string;
  messages: string[];
  agent?: string;
}

function computeSteps(status: string, messages: string[], agent?: string): { label: string; state: StepStatus }[] {
  const text = (messages || []).join(' \n ').toLowerCase();

  const accepted = ['queued', 'running', 'in_progress', 'completed', 'failed', 'cancelled'].includes(status) || /registered|accepted|task registry/.test(text);
  const agentSelected = (agent && agent.length > 0) || /selected .*agent|kernel scheduler - selected/.test(text);
  const modelRunning = status === 'running' || status === 'in_progress' || /agent runtime - starting|model adapter - calling|running/.test(text);
  const resultDone = status === 'completed';
  const wasCancelled = status === 'cancelled';
  const hasError = (status === 'failed' && !wasCancelled) || /error|failed/.test(text);

  const steps: { label: string; state: StepStatus }[] = [
    { label: 'Task accepted', state: accepted ? 'done' : 'active' },
    { label: 'Agent selected', state: (hasError && !agentSelected) ? 'error' : agentSelected ? 'done' : accepted ? 'active' : 'pending' },
    { label: 'Model running', state: (hasError && modelRunning) ? 'error' : (wasCancelled && modelRunning) ? 'error' : resultDone ? 'done' : modelRunning ? 'active' : agentSelected ? 'pending' : 'pending' },
    { label: 'Result generated', state: hasError ? 'error' : wasCancelled ? 'error' : resultDone ? 'done' : 'pending' },
  ];

  return steps;
}

function dotClass(state: StepStatus) {
  switch (state) {
    case 'done':
      return 'bg-brand-success';
    case 'active':
      return 'bg-brand-accent animate-pulse';
    case 'error':
      return 'bg-brand-error';
    default:
      return 'bg-brand-muted';
  }
}

function stateTextClass(state: StepStatus) {
  switch (state) {
    case 'done':
      return 'text-brand-success';
    case 'error':
      return 'text-brand-error';
    case 'active':
      return 'text-brand-accent';
    default:
      return 'text-brand-muted';
  }
}

const itemVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
};

export default function TaskTimeline({ status, messages, agent }: TaskTimelineProps) {
  const steps = computeSteps(status, messages, agent);

  return (
    <div className="bg-brand-panel border border-brand-border rounded-lg p-4">
      <div className="text-xs font-semibold text-brand-muted uppercase mb-2">Task Timeline</div>
      <div className="flex flex-col gap-3">
        <AnimatePresence>
          {steps.map((s) => (
            <motion.div
              key={s.label}
              variants={itemVariants}
              initial="initial"
              animate="animate"
              exit="initial"
              className="flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${dotClass(s.state)}`} />
                <span className="text-sm text-brand-text">{s.label}</span>
              </div>
              <span className={`text-xs ${stateTextClass(s.state)}`}>
                {s.state}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
