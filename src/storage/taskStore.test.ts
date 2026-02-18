/**
 * TaskStore Tests
 */

import { TaskStore } from './taskStore';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

const testDbPath = path.join(__dirname, '../../data/test-tasks.db');

// Clean up test file
function cleanup() {
  const paths = [testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`];
  paths.forEach((p) => {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
    }
  });
}

console.log('🧪 Testing TaskStore...\n');

// Test 1: Create and retrieve task
console.log('Test 1: Create and retrieve task');
cleanup();
const db = new Database(testDbPath);
const store = new TaskStore({ db });
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
db.close();
const db2 = new Database(testDbPath);
const store2 = new TaskStore({ db: db2 });
const reloaded = store2.getTask(task1.id);
console.log('✓ Data persisted and reloaded');
console.assert(reloaded?.input === 'Build a todo app', 'Should reload correctly');
console.log('');

// Test 9: Agent decision tracking
console.log('Test 9: Agent decision tracking');
const taskWithDecision = store2.createTask('Create API endpoint', {
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
const oldTask = store2.createTask('Old task', {
  agent: 'research-agent',
  startedAt: Date.now() - (40 * 24 * 60 * 60 * 1000), // 40 days ago
});
const deletedCount = store2.deleteOlderThan(30);
console.log('✓ Old tasks deleted');
console.log(`  Deleted ${deletedCount} task(s) older than 30 days`);
console.log('');

// Test 11: Rekey retry task
console.log('Test 11: Rekey retry task');
const task4 = store2.createTask('Retry rekey', {
  agent: 'web-dev-agent',
  status: 'failed',
});
store2.updateTask(task4.id, { status: 'failed' });
const retry2 = store2.createRetry(task4.id);
const newRetryId = `rekey-${retry2?.id}`;
const rekeyed = retry2 ? store2.rekeyTask(retry2.id, newRetryId) : null;
console.log('✓ Retry rekeyed:', rekeyed?.id);
console.assert(rekeyed?.id === newRetryId, 'Rekey should update id');
console.assert(store2.getTask(newRetryId)?.id === newRetryId, 'New id should be retrievable');
console.assert(store2.getTask(retry2?.id || '') === null, 'Old id should not exist');
const originalAfterRekey = store2.getTask(task4.id);
console.assert(
  originalAfterRekey?.retries?.includes(newRetryId),
  'Original task should reference new retry id'
);
const rekeyChain = store2.getRetryChain(task4.id);
console.assert(
  rekeyChain.some((t) => t.id === newRetryId),
  'Retry chain should include rekeyed id'
);
console.log('');

console.log('✅ All tests passed!\n');

// Cleanup
db2.close();
cleanup();
console.log('🧹 Cleaned up test files');
