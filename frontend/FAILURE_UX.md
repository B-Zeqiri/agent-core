# Failure UX System - Professional Error Handling

## Overview

The Failure UX system provides a **polished, professional error display** that shows:
1. **Where** the failure occurred (which layer)
2. **Why** it failed (error details)
3. **How** to fix it (actionable suggestions)

This separates professional systems from basic tools.

## Features

### 🎯 Layer-Level Error Tracking
The system identifies exactly which layer failed:
- **API Gateway** 🌐 - Network/connectivity issues
- **Task Registry** 📋 - Task validation/registration errors
- **Orchestrator** 🎯 - Workflow execution failures
- **Scheduler** ⏱️ - Scheduling/queueing problems
- **Agent Runtime** 🤖 - Agent execution errors
- **Model Adapter** 🧠 - AI model failures
- **Result Store** 💾 - Storage/persistence issues
- **Event Stream** 📡 - Event bus problems

### 📊 Smart Error Detection
Automatically detects common error patterns:
- **ECONNREFUSED** - Server connection issues
- **TIMEOUT** - Request timeout errors
- **NOT_FOUND** - Missing resources (404)
- **VALIDATION** - Input validation failures
- **MODEL_ERROR** - AI model execution errors
- **PERMISSION** - Authorization/permission issues

### 💡 Actionable Suggestions
Provides context-aware fix suggestions:
```
Connection Refused:
1. Check if the backend server is running
2. Verify the server port (default: 3000)
3. Check firewall settings
```

### 🎨 Visual Design
- **Color-coded layers** - Each layer has a unique color
- **Error highlighting** - Red borders and backgrounds
- **Collapsible stack traces** - Technical details on demand
- **Smooth animations** - Professional transitions

## Component API

### FailurePanel Component

```typescript
interface FailureDetails {
  layer: string;           // Which layer failed
  error: string;           // Error message
  errorCode?: string;      // Error code (e.g., "ECONNREFUSED")
  timestamp: number;       // When it failed
  stackTrace?: string;     // Technical stack trace
  suggestions?: string[];  // How to fix it
}

<FailurePanel
  failure={failureDetails}
  taskInput="User's original task"
  onRetry={() => {/* Retry logic */}}
  onFix={(suggestion) => {/* Apply fix */}}
  onDismiss={() => {/* Close panel */}}
/>
```

## Integration

### 1. Task Interface (App.tsx)
Extended Task interface with failure fields:
```typescript
interface Task {
  // ... existing fields
  error?: string;
  errorCode?: string;
  failedLayer?: string;
  stackTrace?: string;
  suggestions?: string[];
}
```

### 2. MainWorkspace Integration
Captures failure details when tasks fail:
```typescript
if (task.status === 'failed') {
  setFailureDetails({
    layer: task.failedLayer || 'Agent Runtime',
    error: task.error || 'Task execution failed',
    errorCode: task.errorCode,
    timestamp: Date.now(),
    stackTrace: task.stackTrace,
    suggestions: task.suggestions,
  });
}
```

### 3. UI Display
Shows FailurePanel in failed state:
```typescript
{uiState === 'failed' && failureDetails && (
  <FailurePanel
    failure={failureDetails}
    taskInput={currentTask.input}
    onRetry={handleRetry}
    onDismiss={() => setFailureDetails(null)}
  />
)}
```

## Backend Integration

The backend should return failure information:

```typescript
// Example backend response for failed task
{
  status: 'failed',
  error: 'Connection timeout',
  errorCode: 'TIMEOUT',
  failedLayer: 'Model Adapter',
  stackTrace: 'Error: timeout\n  at ...',
  suggestions: [
    'The task took too long to complete',
    'Try breaking down the task into smaller steps',
    'Check server performance and load'
  ]
}
```

## Error Pattern Detection

The system automatically detects patterns:

```typescript
// Connection errors
"ECONNREFUSED" → Shows server startup suggestions

// Timeout errors
"TIMEOUT" → Suggests task breakdown

// Validation errors
"VALIDATION" → Shows input format help

// Model errors
"MODEL" → Suggests rephrasing or different agent

// Permission errors
"PERMISSION" → Shows permission configuration help
```

## User Experience Flow

1. **Task Fails** → System captures failure details
2. **Error Display** → Shows polished FailurePanel with:
   - Failed layer with color-coded icon
   - Clear error message
   - Original task for context
   - Actionable suggestions (1, 2, 3...)
3. **User Actions**:
   - Click "Retry Task" to try again
   - Click suggestion "Apply" buttons
   - Click "Dismiss" to close panel
   - Expand stack trace for technical details

## Styling

Uses brand colors from theme:
- `brand-error` - Error red (#EF4444)
- `brand-success` - Success green (#10B981)
- `brand-accent` - Accent blue
- `brand-panel` - Panel backgrounds
- `brand-border` - Border colors

## Example Usage

```typescript
// Simulate a model error
const failureDetails: FailureDetails = {
  layer: 'Model Adapter',
  error: 'Model inference failed: context length exceeded',
  errorCode: 'MODEL_ERROR',
  timestamp: Date.now(),
  stackTrace: 'Error: Context too long...',
  suggestions: [
    'The AI model context limit was exceeded',
    'Try shortening your input',
    'Break the task into multiple smaller requests'
  ]
};

<FailurePanel
  failure={failureDetails}
  taskInput="Analyze this 50-page document..."
  onRetry={() => console.log('Retrying...')}
  onDismiss={() => console.log('Dismissed')}
/>
```

## Benefits

✅ **Professional UX** - Clear, actionable error messages
✅ **User Empowerment** - Suggestions help users fix issues
✅ **Technical Transparency** - Stack traces available when needed
✅ **Layer Visibility** - Users know exactly where failure occurred
✅ **Quick Recovery** - One-click retry functionality
✅ **Context Preservation** - Shows original task alongside error

## Testing

To test the failure UX:

1. **Network Error**:
   - Stop backend server
   - Submit task
   - See "Connection Refused" panel

2. **Validation Error**:
   - Submit invalid input
   - See validation suggestions

3. **Model Error**:
   - Submit very long input
   - See context length suggestions

4. **Permission Error**:
   - Try restricted operation
   - See permission configuration help

## Future Enhancements

- [ ] Copy error to clipboard
- [ ] Report bug directly from panel
- [ ] Automatic retry with exponential backoff
- [ ] Error analytics/tracking
- [ ] Suggested alternative agents
- [ ] Auto-fix for common issues

---

This failure UX system transforms errors from frustrating dead-ends into actionable learning opportunities.
