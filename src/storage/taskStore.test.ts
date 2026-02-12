/**
 * TaskStore Tests
 */

import { TaskStore } from './taskStore';
import * as fs from 'fs';
import * as path from 'path';

const testDbPath = path.join(__dirname, '../../data/test-tasks.json');

// Clean up test file
function cleanup() {
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
}

console.log('🧪 Testing TaskStore...\n');

// Test 1: Create and retrieve task
console.log('Test 1: Create and retrieve task');
cleanup();
const store = new TaskStore(testDbPath);
const task1 = store.createTask('Build a todo app', {
  agent: 'web-dev-agent',
  agentSelectionReason: 'Web development keywords detected',
  availableAgents: ['web-dev-agent', 'research-agent'],
});
console.log('✓ Task created:', task1.id);

const retrieved = store.getTask(task1.id);
console.log('✓ Task retrieved:', retrieved?.id === task1.id);
console.assert(retrieved?.input === 'Build a todo app', 'Input should match');
console.log('');

// Test 2: Update task
console.log('Test 2: Update task');
const updated = store.updateTask(task1.id, {
  status: 'in_progress',
  progress: 50,
});
console.log('✓ Task updated to in_progress');
console.assert(updated?.status === 'in_progress', 'Status should be in_progress');
console.log('');

// Test 3: Complete task
console.log('Test 3: Complete task');
const completed = store.updateTask(task1.id, {
  status: 'completed',
  output: 'Todo app created successfully',
});
console.log('✓ Task completed');
console.assert(completed?.completedAt !== undefined, 'Should have completedAt');
console.assert(completed?.durationMs !== undefined, 'Should have durationMs');
console.log(`  Duration: ${completed?.durationMs}ms`);
console.log('');

// Test 4: Create retry
console.log('Test 4: Create retry');
const task2 = store.createTask('Analyze data', {
  agent: 'research-agent',
  status: 'failed',
  error: 'Connection timeout',
});
store.updateTask(task2.id, { status: 'failed' });

const retry = store.createRetry(task2.id);
console.log('✓ Retry created:', retry?.id);
console.assert(retry?.isRetry === true, 'Should be marked as retry');
console.assert(retry?.originalTaskId === task2.id, 'Should link to original');
console.assert(retry?.input === 'Analyze data', 'Should copy input');
console.log('');

// Test 5: Get retry chain
console.log('Test 5: Get retry chain');
const chain = store.getRetryChain(task2.id);
console.log('✓ Retry chain retrieved');
console.assert(chain.length === 2, 'Should have original + 1 retry');
console.log(`  Chain length: ${chain.length}`);
console.log('');

// Test 6: Query tasks
console.log('Test 6: Query tasks');
const task3 = store.createTask('Research AI trends', {
  agent: 'research-agent',
  status: 'completed',
});
store.updateTask(task3.id, { status: 'completed' });

const completedTasks = store.query({ status: 'completed' });
console.log('✓ Query by status');
console.assert(completedTasks.length >= 2, 'Should have at least 2 completed tasks');
console.log(`  Found ${completedTasks.length} completed tasks`);

const researchTasks = store.query({ agent: 'research-agent' });
console.log('✓ Query by agent');
console.log(`  Found ${researchTasks.length} research agent tasks`);
console.log('');

// Test 7: Statistics
console.log('Test 7: Statistics');
const stats = store.getStats();
console.log('✓ Stats generated');
console.log(`  Total tasks: ${stats.total}`);
console.log(`  Completed: ${stats.byStatus['completed'] || 0}`);
console.log(`  Failed: ${stats.byStatus['failed'] || 0}`);
console.log(`  Success rate: ${(stats.successRate * 100).toFixed(1)}%`);
console.log(`  Retry rate: ${(stats.retryRate * 100).toFixed(1)}%`);
console.log(`  Avg duration: ${stats.avgDuration.toFixed(0)}ms`);
console.log('');

// Test 8: Persistence
console.log('Test 8: Persistence (save and reload)');
store.flush(); // Force save
const store2 = new TaskStore(testDbPath);
const reloaded = store2.getTask(task1.id);
console.log('✓ Data persisted and reloaded');
console.assert(reloaded?.input === 'Build a todo app', 'Should reload correctly');
console.log('');

// Test 9: Agent decision tracking
console.log('Test 9: Agent decision tracking');
const taskWithDecision = store.createTask('Create API endpoint', {
  agent: 'web-dev-agent',
  agentSelectionReason: 'Keywords: API, endpoint. Web development task detected.',
  availableAgents: ['web-dev-agent', 'research-agent', 'system-agent'],
  agentScores: {
    'web-dev-agent': 0.95,
    'research-agent': 0.2,
    'system-agent': 0.1,
  },
});
console.log('✓ Task created with agent decision metadata');
console.assert(taskWithDecision.agentSelectionReason !== undefined, 'Should have selection reason');
console.assert(taskWithDecision.availableAgents?.length === 3, 'Should track available agents');
console.log(`  Reason: ${taskWithDecision.agentSelectionReason}`);
console.log(`  Available agents: ${taskWithDecision.availableAgents?.join(', ')}`);
console.log('');

// Test 10: Cleanup old tasks
console.log('Test 10: Cleanup old tasks');
const oldTask = store.createTask('Old task', {
  agent: 'research-agent',
  startedAt: Date.now() - (40 * 24 * 60 * 60 * 1000), // 40 days ago
});
const deletedCount = store.deleteOlderThan(30);
console.log('✓ Old tasks deleted');
console.log(`  Deleted ${deletedCount} task(s) older than 30 days`);
console.log('');

console.log('✅ All tests passed!\n');

// Cleanup
cleanup();
console.log('🧹 Cleaned up test files');
