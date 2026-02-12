import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { GenerationConfig, UIState } from '../App';

interface TaskInputProps {
  onStateChange: (state: UIState) => void;
  onTaskChange: (task: any) => void;
  generation: GenerationConfig;
  onGenerationChange: (next: GenerationConfig) => void;
  onPollTask: (taskId: string) => void;
}

function TaskInput({
  onStateChange,
  onTaskChange,
  generation,
  onGenerationChange,
  onPollTask,
}: TaskInputProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const effectiveGeneration: GenerationConfig =
    generation.mode === 'deterministic'
      ? { ...generation, temperature: 0 }
      : { mode: 'creative' };

  const multiAgentPayload = {
    enabled: true,
    mode: 'auto',
    planner: 'rule',
    failurePolicy: {
      defaultAction: 'continue',
      retries: 0,
    },
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    setLoading(true);
    
    // Set initial task state immediately
    onTaskChange({
      id: 'pending...',
      status: 'submitting',
      agent: '',
      input: input.trim(),
      progress: 0,
      messages: [],
      generation: effectiveGeneration,
      startedAt: Date.now(),
    });
    onStateChange('submitting');

    try {
      const submittedInput = input.trim();
      const res = await fetch('/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: submittedInput,
          generation: effectiveGeneration,
          multiAgent: multiAgentPayload,
        }),
      });

      if (!res.ok) throw new Error('Failed to submit task');

      const { taskId } = await res.json();

      onTaskChange({
        id: taskId,
        status: 'queued',
        agent: '',
        input: submittedInput,
        progress: 0,
        messages: [],
        generation: effectiveGeneration,
        startedAt: Date.now(),
      });

      onStateChange('queued');
      setInput('');

      // Polling is centralized in MainWorkspace to avoid duplicate pollers and race conditions.
      onPollTask(taskId);
    } catch (err) {
      console.error('Submit error:', err);
      onStateChange('idle');
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ scale: 0.95, opacity: 0, y: 20 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 0.95, opacity: 0, y: -20 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="w-full max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <h2 className="text-2xl font-semibold text-brand-text mb-2 bg-gradient-to-r from-white to-brand-muted bg-clip-text text-transparent">What do you need?</h2>
          <p className="text-sm text-brand-muted">Describe your task. The right agent will handle it.</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="space-y-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-brand-muted">Mode</div>

            <div className="relative inline-flex items-center rounded-full border border-brand-border bg-brand-dark/40 p-1 backdrop-blur-xl shadow-lg shadow-black/20">
              <motion.div
                className="absolute top-1 bottom-1 rounded-full"
                initial={false}
                animate={{
                  left: generation.mode === 'creative' ? '4px' : '50%',
                  width: 'calc(50% - 4px)',
                }}
                transition={{ type: 'spring', stiffness: 420, damping: 35 }}
                style={{
                  background:
                    generation.mode === 'creative'
                      ? 'linear-gradient(135deg, rgba(59,130,246,0.35), rgba(59,130,246,0.15))'
                      : 'linear-gradient(135deg, rgba(16,185,129,0.28), rgba(16,185,129,0.12))',
                  boxShadow:
                    generation.mode === 'creative'
                      ? '0 10px 30px rgba(59,130,246,0.18)'
                      : '0 10px 30px rgba(16,185,129,0.18)',
                }}
              />

              <button
                type="button"
                disabled={loading}
                onClick={() => onGenerationChange({ mode: 'creative' })}
                className={
                  'relative z-10 w-40 px-3 py-2 rounded-full text-sm font-medium transition-all duration-200 ' +
                  (generation.mode === 'creative'
                    ? 'text-brand-text'
                    : 'text-brand-muted hover:text-brand-text')
                }
              >
                <span className="flex items-center justify-center gap-2">
                  <span className={generation.mode === 'creative' ? 'opacity-100' : 'opacity-80'}>🧠</span>
                  Creative
                </span>
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={() => onGenerationChange({ mode: 'deterministic' })}
                className={
                  'relative z-10 w-40 px-3 py-2 rounded-full text-sm font-medium transition-all duration-200 ' +
                  (generation.mode === 'deterministic'
                    ? 'text-brand-text'
                    : 'text-brand-muted hover:text-brand-text')
                }
              >
                <span className="flex items-center justify-center gap-2">
                  <span className={generation.mode === 'deterministic' ? 'opacity-100' : 'opacity-80'}>📐</span>
                  Deterministic
                </span>
              </button>
            </div>
          </div>

        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="relative"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!loading && input.trim()) {
                  handleSubmit(e as any);
                }
              }
            }}
            disabled={loading}
            placeholder="Build me a todo app... Analyze this data... Create a UI..."
            className="w-full h-32 px-4 py-3 bg-brand-dark/50 backdrop-blur-xl border border-brand-border rounded-xl text-brand-text placeholder-brand-muted focus:outline-none focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20 resize-none disabled:opacity-50 transition-all duration-300 shadow-xl"
          />
          {loading && (
            <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-accent/5 to-transparent animate-shimmer" />
            </div>
          )}
        </motion.div>

        <motion.button
          type="submit"
          disabled={loading || !input.trim()}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          whileHover={{ scale: 1.02, boxShadow: "0 20px 40px rgba(59, 130, 246, 0.3)" }}
          whileTap={{ scale: 0.98 }}
          className="w-full px-4 py-3 bg-gradient-to-r from-brand-accent to-blue-500 text-white font-semibold rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-lg shadow-brand-accent/30 relative overflow-hidden"
        >
          {loading && (
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
              animate={{ x: [-200, 200] }}
              transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
            />
          )}
          <span className="relative z-10 flex items-center justify-center gap-2">
            {loading && (
              <motion.div
                className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
              />
            )}
            {loading ? 'Submitting...' : 'Submit Task'}
          </span>
        </motion.button>
      </form>
    </motion.div>
  );
}

export default TaskInput;
