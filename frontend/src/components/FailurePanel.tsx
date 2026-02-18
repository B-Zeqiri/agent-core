import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface FailureDetails {
  layer: string;
  error: string;
  errorCode?: string;
  timestamp: number;
  stackTrace?: string;
  suggestions?: string[];
}

interface FailurePanelProps {
  failure: FailureDetails;
  taskInput: string;
  onRetry: () => void;
  onFix?: (suggestion: string) => void;
  onDismiss?: () => void;
}

// Map layers to user-friendly names and icons
const LAYER_INFO: Record<string, { name: string; icon: string; color: string }> = {
  'API Gateway': { name: 'API Gateway', icon: '🌐', color: 'text-blue-400' },
  'Task Registry': { name: 'Task Registry', icon: '📋', color: 'text-purple-400' },
  'Orchestrator': { name: 'Orchestrator', icon: '🎯', color: 'text-green-400' },
  'Scheduler': { name: 'Scheduler', icon: '⏱️', color: 'text-yellow-400' },
  'Agent Runtime': { name: 'Agent Runtime', icon: '🤖', color: 'text-orange-400' },
  'Model Adapter': { name: 'Model Adapter', icon: '🧠', color: 'text-pink-400' },
  'Result Store': { name: 'Result Store', icon: '💾', color: 'text-cyan-400' },
  'Event Stream': { name: 'Event Stream', icon: '📡', color: 'text-indigo-400' },
  'Network': { name: 'Network', icon: '🔌', color: 'text-red-400' },
};

// Common error patterns and their fixes
const ERROR_PATTERNS: Record<string, { title: string; suggestions: string[] }> = {
  'ECONNREFUSED': {
    title: 'Connection Refused',
    suggestions: [
      'Check if the backend server is running',
      'Verify the server port (default: 3000)',
      'Check firewall settings',
    ],
  },
  'TIMEOUT': {
    title: 'Request Timeout',
    suggestions: [
      'The task took too long to complete',
      'Try breaking down the task into smaller steps',
      'Check server performance and load',
    ],
  },
  'NOT_FOUND': {
    title: 'Resource Not Found',
    suggestions: [
      'The requested resource doesn\'t exist',
      'Check if the task ID is correct',
      'Verify API endpoints are configured correctly',
    ],
  },
  'VALIDATION': {
    title: 'Validation Error',
    suggestions: [
      'Check your input format',
      'Ensure all required fields are provided',
      'Review the task requirements',
    ],
  },
  'MODEL_ERROR': {
    title: 'Model Execution Failed',
    suggestions: [
      'The AI model encountered an error',
      'Try rephrasing your request',
      'Check if the model supports this type of task',
    ],
  },
  'PERMISSION': {
    title: 'Permission Denied',
    suggestions: [
      'The agent doesn\'t have permission for this action',
      'Check tool permissions in the configuration',
      'Try a different agent with appropriate permissions',
    ],
  },
};

function detectErrorPattern(error: string): string | null {
  const errorUpper = error.toUpperCase();
  if (errorUpper.includes('ECONNREFUSED') || errorUpper.includes('CONNECTION REFUSED')) return 'ECONNREFUSED';
  if (errorUpper.includes('TIMEOUT') || errorUpper.includes('TIMED OUT')) return 'TIMEOUT';
  if (errorUpper.includes('NOT FOUND') || errorUpper.includes('404')) return 'NOT_FOUND';
  if (errorUpper.includes('VALIDATION') || errorUpper.includes('INVALID')) return 'VALIDATION';
  if (errorUpper.includes('MODEL') || errorUpper.includes('INFERENCE')) return 'MODEL_ERROR';
  if (errorUpper.includes('PERMISSION') || errorUpper.includes('FORBIDDEN') || errorUpper.includes('403')) return 'PERMISSION';
  return null;
}

export default function FailurePanel({ failure, taskInput, onRetry, onFix, onDismiss }: FailurePanelProps) {
  const [showStackTrace, setShowStackTrace] = useState(false);
  const [expandedSuggestion, setExpandedSuggestion] = useState<number | null>(null);
  const [showHelpTip, setShowHelpTip] = useState(true);

  const layerInfo = LAYER_INFO[failure.layer] || { 
    name: failure.layer, 
    icon: '⚠️', 
    color: 'text-gray-400' 
  };

  const errorPattern = detectErrorPattern(failure.error);
  const errorInfo = errorPattern ? ERROR_PATTERNS[errorPattern] : null;
  const suggestions = failure.suggestions || errorInfo?.suggestions || [];

  const formatTimestamp = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="bg-brand-panel border-2 border-brand-error rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
    >
      {/* Help Tip Banner */}
      <AnimatePresence>
        {showHelpTip && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-brand-accent/10 border-b border-brand-accent/30 px-4 py-3 overflow-hidden"
          >
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-brand-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-3 h-3 text-brand-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-sm text-brand-accent">
                  <strong>Don't worry!</strong> We've identified the issue and provided suggestions below to help you fix it.
                </p>
              </div>
              <button
                onClick={() => setShowHelpTip(false)}
                className="text-brand-accent/60 hover:text-brand-accent transition-colors"
                aria-label="Dismiss tip"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="bg-gradient-to-r from-brand-error/20 to-brand-error/10 border-b border-brand-error/30 p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-full bg-brand-error/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-brand-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-brand-error mb-1">
                {errorInfo?.title || 'Task Failed'}
              </h3>
              <p className="text-sm text-brand-muted">
                Failed at <span className={layerInfo.color}>{layerInfo.icon} {layerInfo.name}</span> • {formatTimestamp(failure.timestamp)}
              </p>
              {failure.errorCode && (
                <span className="inline-block mt-2 px-2 py-1 bg-brand-error/10 border border-brand-error/30 rounded text-xs font-mono text-brand-error">
                  {failure.errorCode}
                </span>
              )}
            </div>
          </div>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="p-1 rounded hover:bg-brand-error/10 transition-colors"
              aria-label="Dismiss"
            >
              <svg className="w-5 h-5 text-brand-muted hover:text-brand-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Error Details */}
      <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
        {/* Original Task */}
        <div>
          <div className="text-xs text-brand-muted uppercase tracking-wide mb-2 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Your Task
          </div>
          <div className="p-3 bg-brand-dark/50 border border-brand-border rounded-lg">
            <p className="text-sm text-white font-mono whitespace-pre-wrap">{taskInput}</p>
          </div>
        </div>

        {/* Error Message */}
        <div>
          <div className="text-xs text-brand-muted uppercase tracking-wide mb-2 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Error Details
          </div>
          <div className="p-3 bg-brand-error/5 border border-brand-error/30 rounded-lg">
            <p className="text-sm text-brand-error font-mono whitespace-pre-wrap">{failure.error}</p>
          </div>
        </div>

        {/* Stack Trace (if available) */}
        {failure.stackTrace && (
          <div>
            <button
              onClick={() => setShowStackTrace(!showStackTrace)}
              className="text-xs text-brand-muted hover:text-brand-text uppercase tracking-wide mb-2 flex items-center gap-2 transition-colors"
            >
              <svg 
                className={`w-4 h-4 transition-transform ${showStackTrace ? 'rotate-90' : ''}`} 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Stack Trace
            </button>
            <AnimatePresence>
              {showStackTrace && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="p-3 bg-brand-dark border border-brand-border rounded-lg max-h-48 overflow-y-auto">
                    <pre className="text-xs text-brand-muted font-mono whitespace-pre-wrap">{failure.stackTrace}</pre>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div>
            <div className="text-xs text-brand-success uppercase tracking-wide mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              Suggested Fixes
            </div>
            <div className="space-y-2">
              {suggestions.map((suggestion, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  className="p-3 bg-brand-success/5 border border-brand-success/20 rounded-lg hover:border-brand-success/40 transition-colors cursor-pointer group"
                  onClick={() => setExpandedSuggestion(expandedSuggestion === idx ? null : idx)}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-brand-success/20 flex items-center justify-center flex-shrink-0 group-hover:bg-brand-success/30 transition-colors">
                      <span className="text-xs text-brand-success font-bold">{idx + 1}</span>
                    </div>
                    <p className="text-sm text-brand-text flex-1">{suggestion}</p>
                    {onFix && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onFix(suggestion);
                        }}
                        className="px-2 py-1 bg-brand-success/20 hover:bg-brand-success/30 border border-brand-success/30 rounded text-xs text-brand-success transition-colors"
                      >
                        Apply
                      </button>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="bg-brand-dark/30 border-t border-brand-border p-4 space-y-3">
        <div className="flex gap-3">
          <button
            onClick={onRetry}
            className="flex-1 px-4 py-2.5 bg-brand-accent hover:bg-brand-accent/80 border border-brand-accent/50 rounded-lg text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Retry Task
          </button>
          <button
            onClick={onDismiss || (() => {})}
            className="px-4 py-2.5 bg-brand-panel hover:bg-brand-border/30 border border-brand-border rounded-lg text-sm font-semibold text-brand-text transition-colors"
          >
            Dismiss
          </button>
        </div>
        
        {/* Help Links */}
        <div className="flex items-center justify-center gap-4 text-xs text-brand-muted">
          <a
            href={`?test=failure&error=${encodeURIComponent(failure.layer)}`}
            target="_blank"
            className="hover:text-brand-accent transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            View This Error in Guide
          </a>
          <span className="text-brand-border">•</span>
          <button
            onClick={() => {
              const issueBody = `**Error**: ${failure.error}\n**Layer**: ${failure.layer}\n**Task**: ${taskInput}\n**Time**: ${new Date(failure.timestamp).toISOString()}`;
              const mailto = `mailto:support@example.com?subject=Error Report: ${failure.errorCode || 'Unknown'}&body=${encodeURIComponent(issueBody)}`;
              window.location.href = mailto;
            }}
            className="hover:text-brand-accent transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Report This Issue
          </button>
        </div>
      </div>
    </motion.div>
  );
}
