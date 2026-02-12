# Testing the Failure UX System

## Quick Start

### Option 1: Test Page (Recommended)

Access the interactive test page to see all failure scenarios:

```
http://localhost:5173/?test=failure
```

This will load a dedicated test interface where you can:
- Click different error scenarios (Connection, Timeout, Validation, etc.)
- See the failure panel in action
- Test retry functionality
- Test suggestion apply buttons
- Customize the task input
- View stack traces

### Option 2: Simulate Real Failure

To test with actual task failures, you can:

1. **Stop the backend server** to trigger connection errors:
   ```bash
   # Stop your backend
   # Then submit a task in the UI
   ```

2. **Submit invalid input** to trigger validation errors

3. **Use very long input** to trigger model context errors

## Test Scenarios Available

### 1. Connection Error (ECONNREFUSED)
- **Layer**: API Gateway
- **When**: Backend server is not running
- **Shows**: Server startup suggestions

### 2. Timeout Error
- **Layer**: Model Adapter
- **When**: Request takes too long
- **Shows**: Task breakdown suggestions

### 3. Validation Error
- **Layer**: Task Registry
- **When**: Input validation fails
- **Shows**: Input format help

### 4. Model Error
- **Layer**: Model Adapter
- **When**: AI model fails (context length, etc.)
- **Shows**: Model-specific suggestions

### 5. Permission Error
- **Layer**: Agent Runtime
- **When**: Agent lacks permissions
- **Shows**: Permission configuration help

### 6. Not Found Error
- **Layer**: Orchestrator
- **When**: Resource doesn't exist
- **Shows**: ID verification help

### 7. Queue Full Error
- **Layer**: Scheduler
- **When**: Too many tasks queued
- **Shows**: Wait/retry suggestions

### 8. Network Error
- **Layer**: Network
- **When**: External API unavailable
- **Shows**: Connectivity troubleshooting

## What to Test

### ✅ Visual Design
- [ ] Error panel displays with red border
- [ ] Layer icon and color are correct
- [ ] Timestamp shows current time
- [ ] Error code badge appears
- [ ] Original task is displayed

### ✅ Suggestions
- [ ] Numbered suggestions appear (1, 2, 3...)
- [ ] Suggestions are relevant to error type
- [ ] "Apply" buttons work (if enabled)
- [ ] Suggestions are clickable

### ✅ Stack Trace
- [ ] Stack trace toggle works
- [ ] Technical details expand/collapse
- [ ] Monospace font for readability
- [ ] Scrollable when long

### ✅ Actions
- [ ] "Retry Task" button works
- [ ] "Dismiss" button closes panel
- [ ] Panel animations are smooth
- [ ] Button hover states work

### ✅ Responsiveness
- [ ] Panel looks good on desktop
- [ ] Panel is readable on mobile
- [ ] Scrolling works when content is long

## Backend Integration

To make this work with real failures, your backend should return:

```typescript
// When a task fails
{
  status: 'failed',
  error: 'Clear error message',
  errorCode: 'ERROR_CODE',
  failedLayer: 'Model Adapter',
  stackTrace: 'Technical stack trace...',
  suggestions: [
    'First suggestion',
    'Second suggestion',
    'Third suggestion'
  ]
}
```

## Example Test Flow

1. **Open test page**: `http://localhost:5173/?test=failure`

2. **Click "Connection Error"** scenario
   - See API Gateway failure
   - Note the 🌐 blue icon
   - Read the 3 suggestions
   - Click "Retry Task"

3. **Click "Model Error"** scenario
   - See Model Adapter failure
   - Note the 🧠 pink icon
   - Expand stack trace
   - Try "Apply" on a suggestion

4. **Customize task input**
   - Type: "Analyze my 100-page document"
   - Click "Timeout" scenario
   - See how context affects display

5. **Test dismiss**
   - Click "Dismiss" button
   - Panel should close smoothly

## Development Mode

To test while developing:

```bash
# Terminal 1: Frontend
cd frontend
npm run dev

# Terminal 2: Backend (optional - stop to test connection errors)
cd ..
npm run dev

# Browser
# Navigate to: http://localhost:5173/?test=failure
```

## Production Testing

When deployed, you can still access the test page:

```
https://your-domain.com/?test=failure
```

To disable in production, modify `App.tsx`:

```typescript
const isTestMode = 
  import.meta.env.DEV && 
  new URLSearchParams(window.location.search).get('test') === 'failure';
```

## Troubleshooting

**Test page not showing?**
- Check URL: `?test=failure` parameter is present
- Verify `FailureTestPage.tsx` is imported in `App.tsx`
- Check browser console for errors

**Failure panel not displaying?**
- Verify task status is `'failed'`
- Check `failureDetails` state is set
- Ensure `uiState === 'failed'`

**Retry not working?**
- Check `onRetry` callback is implemented
- Verify fetch to `/task` endpoint
- Check browser network tab

## Next Steps

After testing:
1. Verify all scenarios display correctly
2. Ensure suggestions are helpful
3. Test retry functionality end-to-end
4. Customize error messages for your use case
5. Add more error patterns as needed
6. Integrate with backend error responses

---

**Quick Access**: `http://localhost:5173/?test=failure` 🛡️
