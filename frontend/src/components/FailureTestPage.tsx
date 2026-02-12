import React, { useState } from 'react';
import FailurePanel, { FailureDetails } from './FailurePanel';
import { motion } from 'framer-motion';

// Predefined test failure scenarios
const TEST_FAILURES: Record<string, FailureDetails> = {
  connection: {
    layer: 'API Gateway',
    error: 'ECONNREFUSED: Connection refused at 127.0.0.1:3000',
    errorCode: 'ECONNREFUSED',
    timestamp: Date.now(),
    stackTrace: `Error: connect ECONNREFUSED 127.0.0.1:3000
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1495:16)
    at Protocol._enqueue (/app/node_modules/mysql/lib/protocol/Protocol.js:144:48)`,
    suggestions: [
      'Check if the backend server is running',
      'Verify the server is listening on port 3000',
      'Check firewall or network settings',
    ],
  },
  timeout: {
    layer: 'Model Adapter',
    error: 'Request timeout: Model took longer than 30 seconds to respond',
    errorCode: 'TIMEOUT',
    timestamp: Date.now(),
    stackTrace: `TimeoutError: Request timed out after 30000ms
    at Timeout._onTimeout (/app/lib/timeout.js:45:23)
    at listOnTimeout (node:internal/timers:559:17)`,
    suggestions: [
      'The task took too long to complete',
      'Try breaking down the task into smaller steps',
      'Increase the timeout limit in settings',
      'Check if the model server is overloaded',
    ],
  },
  validation: {
    layer: 'Task Registry',
    error: 'Validation error: Input exceeds maximum length of 10000 characters',
    errorCode: 'VALIDATION_ERROR',
    timestamp: Date.now(),
    suggestions: [
      'Your input is too long (15,234 characters)',
      'Split your request into multiple smaller tasks',
      'Summarize your input to fit within limits',
    ],
  },
  modelError: {
    layer: 'Model Adapter',
    error: 'Model inference failed: Context length exceeded (max: 4096 tokens)',
    errorCode: 'MODEL_ERROR',
    timestamp: Date.now(),
    stackTrace: `ModelError: context_length_exceeded
    at ModelAdapter.inference (/app/models/adapter.js:234:15)
    at async AgentRuntime.execute (/app/runtime/agent.js:89:22)`,
    suggestions: [
      'The AI model context limit was exceeded',
      'Try shortening your input or conversation history',
      'Break the task into multiple smaller requests',
      'Use a model with larger context window',
    ],
  },
  permission: {
    layer: 'Agent Runtime',
    error: 'Permission denied: Agent "web-dev-agent" does not have access to tool "file-system"',
    errorCode: 'PERMISSION_DENIED',
    timestamp: Date.now(),
    suggestions: [
      'The agent doesn\'t have permission for this action',
      'Check tool permissions in agent configuration',
      'Try using the "system-agent" which has broader permissions',
      'Contact administrator to grant required permissions',
    ],
  },
  notFound: {
    layer: 'Orchestrator',
    error: 'Task not found: No task with ID "task-12345" exists',
    errorCode: 'NOT_FOUND',
    timestamp: Date.now(),
    suggestions: [
      'The requested task ID doesn\'t exist',
      'The task may have been deleted',
      'Check if you copied the correct task ID',
    ],
  },
  scheduler: {
    layer: 'Scheduler',
    error: 'Queue overflow: Maximum queue size (100) exceeded',
    errorCode: 'QUEUE_FULL',
    timestamp: Date.now(),
    stackTrace: `QueueError: Queue capacity exceeded
    at Scheduler.enqueue (/app/scheduler/queue.js:67:13)
    at Orchestrator.submit (/app/orchestrator/main.js:156:28)`,
    suggestions: [
      'The task queue is currently full',
      'Wait a few moments and try again',
      'Too many tasks are being processed simultaneously',
      'Consider upgrading to a larger instance',
    ],
  },
  network: {
    layer: 'Network',
    error: 'Network error: Failed to fetch - DNS lookup failed for api.openai.com',
    errorCode: 'NETWORK_ERROR',
    timestamp: Date.now(),
    suggestions: [
      'Check your internet connection',
      'Verify DNS settings',
      'The external API may be temporarily unavailable',
      'Try again in a few moments',
    ],
  },
};

export default function FailureTestPage() {
  const [selectedFailure, setSelectedFailure] = useState<FailureDetails | null>(null);
  const [customTaskInput, setCustomTaskInput] = useState('Analyze the quarterly sales data and create a comprehensive report');
  const [highlightedError, setHighlightedError] = React.useState<string | null>(null);

  // Check if we have a specific error to show from URL
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorParam = params.get('error');
    
    if (errorParam) {
      // Find matching error by layer name
      const matchingError = Object.entries(TEST_FAILURES).find(
        ([_, failure]) => failure.layer.toLowerCase() === errorParam.toLowerCase()
      );
      
      if (matchingError) {
        const [key, failure] = matchingError;
        setSelectedFailure(failure);
        setHighlightedError(key);
        
        // Scroll to the error after a short delay
        setTimeout(() => {
          const element = document.getElementById(`error-${key}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 300);
      }
    }
  }, []);

  const handleRetry = () => {
    alert('Retry button clicked! In production, this would resubmit the task.');
    setSelectedFailure(null);
  };

  const handleFix = (suggestion: string) => {
    alert(`Fix applied: ${suggestion}\n\nIn production, this would apply the suggested fix.`);
  };

  const handleDismiss = () => {
    setSelectedFailure(null);
  };

  return (
    <div className="min-h-screen bg-brand-dark p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-block px-3 py-1 bg-brand-accent/20 border border-brand-accent/30 rounded-full text-xs text-brand-accent mb-3">
            Developer Tool
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">🛡️ Error Reference Guide</h1>
          <p className="text-brand-muted max-w-2xl mx-auto">
            This page helps you understand what different errors look like and how to fix them.
            <br />
            <span className="text-sm">When a real task fails, the error panel will appear automatically.</span>
          </p>
        </div>

        {/* Custom Task Input */}
        <div className="bg-brand-panel border border-brand-border rounded-lg p-4">
          <label className="text-sm text-brand-muted mb-2 block">
            Custom Task Input (will be shown in failure panel):
          </label>
          <input
            type="text"
            value={customTaskInput}
            onChange={(e) => setCustomTaskInput(e.target.value)}
            className="w-full px-3 py-2 bg-brand-dark border border-brand-border rounded text-white text-sm focus:outline-none focus:border-brand-accent"
            placeholder="Enter a task description..."
          />
        </div>

        {/* Test Scenarios Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(TEST_FAILURES).map(([key, failure]) => (
            <motion.button
              key={key}
              id={`error-${key}`}
              onClick={() => setSelectedFailure(failure)}
              className={`bg-brand-panel border rounded-lg p-4 text-left transition-all hover:shadow-lg group ${
                highlightedError === key 
                  ? 'border-brand-accent shadow-lg shadow-brand-accent/20 ring-2 ring-brand-accent/30' 
                  : 'border-brand-border hover:border-brand-accent'
              }`}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              animate={highlightedError === key ? {
                borderColor: ['rgba(59, 130, 246, 0.5)', 'rgba(59, 130, 246, 1)', 'rgba(59, 130, 246, 0.5)'],
              } : {}}
              transition={{ duration: 2, repeat: highlightedError === key ? 2 : 0 }}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-brand-error/20 flex items-center justify-center flex-shrink-0 group-hover:bg-brand-error/30 transition-colors">
                  <svg className="w-5 h-5 text-brand-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-white font-semibold mb-1 capitalize">
                    {key.replace(/([A-Z])/g, ' $1').trim()} Error
                  </h3>
                  <p className="text-xs text-brand-muted mb-2">
                    Layer: <span className="text-brand-accent">{failure.layer}</span>
                  </p>
                  <p className="text-sm text-brand-muted line-clamp-2">
                    {failure.error}
                  </p>
                </div>
                <svg className="w-5 h-5 text-brand-muted group-hover:text-brand-accent transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </motion.button>
          ))}
        </div>

        {/* Failure Panel Display */}
        {selectedFailure && (
          <div className="mt-8">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">Preview:</h2>
              <button
                onClick={() => setSelectedFailure(null)}
                className="px-3 py-1 bg-brand-panel border border-brand-border hover:border-brand-accent rounded text-sm text-brand-text transition-colors"
              >
                Clear
              </button>
            </div>
            <FailurePanel
              failure={selectedFailure}
              taskInput={customTaskInput}
              onRetry={handleRetry}
              onFix={handleFix}
              onDismiss={handleDismiss}
            />
          </div>
        )}

        {/* Legend */}
        <div className="bg-brand-panel border border-brand-border rounded-lg p-4 mt-8">
          <h3 className="text-sm font-semibold text-white mb-3">Layer Icons & Colors:</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="flex items-center gap-2">
              <span>🌐</span>
              <span className="text-blue-400">API Gateway</span>
            </div>
            <div className="flex items-center gap-2">
              <span>📋</span>
              <span className="text-purple-400">Task Registry</span>
            </div>
            <div className="flex items-center gap-2">
              <span>🎯</span>
              <span className="text-green-400">Orchestrator</span>
            </div>
            <div className="flex items-center gap-2">
              <span>⏱️</span>
              <span className="text-yellow-400">Scheduler</span>
            </div>
            <div className="flex items-center gap-2">
              <span>🤖</span>
              <span className="text-orange-400">Agent Runtime</span>
            </div>
            <div className="flex items-center gap-2">
              <span>🧠</span>
              <span className="text-pink-400">Model Adapter</span>
            </div>
            <div className="flex items-center gap-2">
              <span>💾</span>
              <span className="text-cyan-400">Result Store</span>
            </div>
            <div className="flex items-center gap-2">
              <span>📡</span>
              <span className="text-indigo-400">Event Stream</span>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-brand-accent/10 border border-brand-accent/30 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-brand-accent mb-2">💡 Testing Instructions:</h3>
          <ol className="text-sm text-brand-text space-y-1 list-decimal list-inside">
            <li>Click any error scenario card to see the failure panel</li>
            <li>Modify the custom task input to see different contexts</li>
            <li>Click "Retry Task" to test the retry functionality</li>
            <li>Click "Apply" on suggestions to test fix actions</li>
            <li>Expand stack trace to see technical details</li>
            <li>Click "Dismiss" or "Clear" to reset</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
