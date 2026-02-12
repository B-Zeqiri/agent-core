# User Guide: When Tasks Fail

## What Happens When a Task Fails?

When something goes wrong with your task, you'll **automatically** see a detailed error panel - you don't need to do anything special!

## The Error Panel Shows You:

### 1. **What Went Wrong** 
- Clear error message in plain English
- Which part of the system had the issue (e.g., "Model Adapter", "API Gateway")
- When it happened

### 2. **Why It Failed**
- Detailed explanation of the error
- Error code for reference (if applicable)
- Technical details (expandable for advanced users)

### 3. **How to Fix It**
- **Numbered suggestions** (1, 2, 3...) showing specific actions you can take
- Common solutions based on the type of error
- Quick "Apply" buttons for automated fixes (when available)

## Example Flow:

```
You submit a task → Task fails → Error panel appears automatically
                                            ↓
                     Shows: What failed, Why, How to fix
                                            ↓
                     You click: "Retry" or apply a suggestion
```

## Available Actions:

### 🔄 **Retry Task**
- Resubmits your task with the same input
- Use this after fixing the underlying issue
- Example: After starting the backend server, retry a failed connection

### 💡 **Apply Suggestion**
- Some suggestions have "Apply" buttons
- Automatically implements the recommended fix
- Saves you from manual configuration

### ✉️ **Report This Issue**
- Click "Report This Issue" link at the bottom
- Automatically includes error details in email
- Send to support team for help

### 🔍 **View Common Errors**
- Click "View Common Errors" link
- Opens reference guide with all error types
- See examples and solutions

### ❌ **Dismiss**
- Closes the error panel
- You can still retry or start a new task
- Error is saved in task history

## Common Errors You Might See:

### 🌐 Connection Error
**What it means**: Can't reach the backend server
**How to fix**: 
1. Check if the server is running
2. Verify your internet connection
3. Check firewall settings

### ⏱️ Timeout Error
**What it means**: Task took too long
**How to fix**:
1. Break your task into smaller parts
2. Simplify your request
3. Try again later if server is busy

### 📝 Validation Error
**What it means**: Your input doesn't meet requirements
**How to fix**:
1. Check input length limits
2. Review format requirements
3. Read the specific validation message

### 🧠 Model Error
**What it means**: AI model couldn't process your request
**How to fix**:
1. Shorten your input
2. Rephrase your question
3. Try a different agent

### 🔒 Permission Error
**What it means**: Agent doesn't have access
**How to fix**:
1. Try a different agent (e.g., "system-agent")
2. Contact admin for permissions
3. Check if the action is allowed

## Tips:

✅ **Read the suggestions** - They're tailored to your specific error
✅ **Try the first suggestion** - Usually the most common fix
✅ **Use the Retry button** - After addressing the issue
✅ **Check task history** - Failed tasks are saved there too
✅ **Report unclear errors** - Help us improve error messages

## For Developers/Advanced Users:

### Stack Trace
Click the arrow next to "Stack Trace" to see technical details:
- Full error stack
- Line numbers
- Module information
- Useful for debugging and reporting bugs

### Error Reference Guide
Visit `?test=failure` in your browser URL to see:
- All possible error types
- Example error panels
- How each error looks
- What suggestions appear

Example:
```
http://localhost:5173/?test=failure
```

## Need More Help?

1. **View Common Errors** - Click the link in the error panel
2. **Report Issue** - Use the "Report This Issue" link
3. **Check Documentation** - See technical docs for your issue
4. **Contact Support** - Email included in error report

---

**Remember**: The error panel appears automatically when something goes wrong. You don't need to search for it - it finds you! 🛡️
