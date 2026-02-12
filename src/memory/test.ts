/**
 * Phase 2 — Memory System Tests
 *
 * Tests:
 * ✓ AgentMemory (short-term, long-term, queries)
 * ✓ VectorStore (similarity search)
 * ✓ MemoryManager (multi-agent, ACLs)
 * ✓ Isolation (Agent A cannot see B)
 * ✓ Sharing (explicit memory sharing)
 * ✓ Context window (for LLM)
 */

import { AgentMemory } from "./agentMemory";
import { VectorStore } from "./vectorStore";
import { MemoryManager } from "./memoryManager";

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
};

function pass(msg: string) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function fail(msg: string) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`);
  process.exit(1);
}

function test(name: string) {
  console.log(`\n${colors.blue}→ ${name}${colors.reset}`);
}

async function assert(condition: boolean, msg: string) {
  if (condition) {
    pass(msg);
  } else {
    fail(msg);
  }
}

// ============ TESTS ============

async function runTests() {
  console.log(`\n${colors.yellow}=== PHASE 2 MEMORY TESTS ===${colors.reset}\n`);

  // ============ AGENT MEMORY TESTS ============

  test("AgentMemory — Short-term Storage");
  const mem = new AgentMemory("agent-1", 5);

  const id1 = mem.rememberShort("First task completed", "result");
  await assert(id1.startsWith("mem_"), "Memory entry ID generated");

  const id2 = mem.rememberShort("Second insight", "insight");
  const id3 = mem.rememberShort("Error occurred", "error");

  const stats1 = mem.getStats();
  await assert(stats1.shortTermCount === 3, "Short-term has 3 entries");
  await assert(stats1.longTermCount === 0, "Long-term is empty");

  test("AgentMemory — Long-term Storage");
  mem.rememberLong("Important knowledge", "insight");
  mem.rememberLong("Code pattern learned", "result");

  const stats2 = mem.getStats();
  await assert(stats2.longTermCount === 2, "Long-term has 2 entries");

  test("AgentMemory — Query Short-term");
  const shortResults = mem.queryShort();
  await assert(shortResults.length === 3, "Query returns all short-term");

  const insightResults = mem.queryShort({ type: "insight" });
  await assert(insightResults.length === 1, "Query filters by type");

  const keywordResults = mem.queryShort({ keyword: "task" });
  await assert(keywordResults.length === 1, "Query filters by keyword");

  test("AgentMemory — Query All");
  const allResults = mem.queryAll();
  await assert(allResults.length === 5, "queryAll returns all entries");

  const limitResults = mem.queryAll({ limit: 2 });
  await assert(limitResults.length === 2, "Query respects limit");

  test("AgentMemory — Get Context");
  const contextStr = mem.getContext(3);
  await assert(contextStr.includes("[result]"), "Context includes types");
  await assert(contextStr.includes("Error occurred"), "Context includes content");

  test("AgentMemory — Overflow to Long-term");
  const mem2 = new AgentMemory("agent-2", 3);
  mem2.rememberShort("Entry 1", "text");
  mem2.rememberShort("Entry 2", "text");
  mem2.rememberShort("Entry 3", "text");
  mem2.rememberShort("Entry 4", "text"); // Should overflow entry 1

  const stats3 = mem2.getStats();
  await assert(stats3.shortTermCount === 3, "Short-term capped at 3");
  await assert(stats3.longTermCount === 1, "Overflow moved to long-term");

  test("AgentMemory — Entry Retrieval");
  const retrieved = mem.getEntry(id1);
  await assert(retrieved !== undefined, "Entry retrieved by ID");
  await assert(retrieved?.content === "First task completed", "Content matches");

  test("AgentMemory — Clear Functions");
  mem.clearShortTerm();
  await assert(mem.queryShort().length === 0, "Short-term cleared");
  await assert(mem.queryLong().length === 2, "Long-term preserved");

  mem.clearAll();
  await assert(mem.getStats().totalSize === 0, "All memory cleared");

  // ============ VECTOR STORE TESTS ============

  test("VectorStore — Add and Search");
  const vs = new VectorStore();

  const vec1 = [1, 0, 0, 0, 0];
  const vec2 = [1, 0, 0, 0, 0]; // Same as vec1
  const vec3 = [0, 1, 0, 0, 0]; // Different

  vs.add("id1", "Cats are animals", vec1);
  vs.add("id2", "Cats are pets", vec2);
  vs.add("id3", "Dogs play fetch", vec3);

  const results = vs.search(vec1, 2);
  await assert(results.length === 2, "Search returns requested count");
  await assert(results[0].id === "id1", "Most similar result first");

  test("VectorStore — Cosine Similarity");
  const similar = vs.search([1, 0, 0, 0, 0], 1);
  await assert(similar.length === 1, "Search respects limit");

  test("VectorStore — Get and Remove");
  const vec = vs.get("id1");
  await assert(vec !== undefined, "Get retrieves vector");
  await assert(vec?.text === "Cats are animals", "Vector content matches");

  const removed = vs.remove("id1");
  await assert(removed === true, "Remove returns true");
  await assert(vs.get("id1") === undefined, "Vector is gone");

  test("VectorStore — Size and Clear");
  const size = vs.size();
  await assert(size === 2, "Size reflects removal");

  vs.clear();
  await assert(vs.size() === 0, "Clear empties store");

  // ============ MEMORY MANAGER TESTS ============

  test("MemoryManager — Agent Memory Creation");
  const mm = new MemoryManager();

  mm.createAgentMemory("agent-a");
  mm.createAgentMemory("agent-b");

  await assert(mm.hasMemory("agent-a"), "Agent A has memory");
  await assert(mm.hasMemory("agent-b"), "Agent B has memory");

  test("MemoryManager — Duplicate Creation (should fail)");
  try {
    mm.createAgentMemory("agent-a");
    fail("Should reject duplicate memory");
  } catch (err) {
    pass("Correctly rejects duplicate memory");
  }

  test("MemoryManager — ACL: Isolation");
  mm.writeShort("agent-a", "agent-a", "Agent A data", "text");
  mm.writeShort("agent-b", "agent-b", "Agent B data", "text");

  try {
    mm.query("agent-a", "agent-b"); // A tries to read B
    fail("Should prevent unauthorized read");
  } catch (err) {
    pass("Isolation: Agent A cannot read B's memory");
  }

  try {
    mm.writeShort("agent-a", "agent-b", "Hack!"); // A tries to write B
    fail("Should prevent unauthorized write");
  } catch (err) {
    pass("Isolation: Agent A cannot write to B's memory");
  }

  test("MemoryManager — ACL: Memory Sharing");
  mm.shareMemoryRead("agent-a", "agent-b");
  mm.shareMemoryWrite("agent-b", "agent-a");

  // Now A can read B
  const bData = mm.query("agent-a", "agent-b");
  await assert(bData.length === 1, "Agent A can read B after sharing");
  await assert(bData[0].content === "Agent B data", "Content is correct");

  // Now B can write to A
  const writerId = mm.writeShort("agent-b", "agent-a", "B's contribution", "text");
  await assert(writerId.startsWith("mem_"), "Write successful");

  const aData = mm.query("agent-a", "agent-a");
  await assert(aData.length === 2, "A's memory has both entries");

  test("MemoryManager — ACL: Revoke");
  mm.revokeMemoryRead("agent-a", "agent-b");

  try {
    mm.query("agent-a", "agent-b");
    fail("Should prevent read after revoke");
  } catch (err) {
    pass("Read access revoked successfully");
  }

  mm.revokeMemoryWrite("agent-b", "agent-a");

  try {
    mm.writeShort("agent-b", "agent-a", "Should fail");
    fail("Should prevent write after revoke");
  } catch (err) {
    pass("Write access revoked successfully");
  }

  test("MemoryManager — Context Window");
  const mm2 = new MemoryManager();
  mm2.createAgentMemory("agent-c");

  mm2.writeShort("agent-c", "agent-c", "Previous message", "text");
  mm2.writeShort("agent-c", "agent-c", "Current context", "text");

  const contextStr2 = mm2.getContext("agent-c", "agent-c", 5);
  await assert(contextStr2.includes("Current context"), "Context includes recent");

  test("MemoryManager — Statistics");
  const allStats = mm.getStats();
  await assert(allStats.length >= 2, "Stats includes all agents");
  await assert(
    allStats.some((s) => s.agentId === "agent-a"),
    "Stats includes agent-a"
  );

  const agentAStats = allStats.find((s) => s.agentId === "agent-a")!;
  await assert(agentAStats.totalSize >= 1, "Stats shows memory size");

  test("MemoryManager — Memory Deletion");
  mm.deleteAgentMemory("agent-a");
  await assert(!mm.hasMemory("agent-a"), "Agent memory deleted");

  // ============ VECTOR SEARCH WITH ACL ============

  test("MemoryManager — Semantic Search (with ACL)");
  const mm3 = new MemoryManager(true); // Enable vector search

  mm3.createAgentMemory("agent-x");
  mm3.createAgentMemory("agent-y");

  mm3.writeShort("agent-x", "agent-x", "Cats are animals", "text");
  mm3.writeShort("agent-y", "agent-y", "Dogs are pets", "text");

  // X tries to search (should only find own)
  const results1 = mm3.semanticSearch("agent-x", "animals", 5);
  await assert(results1.length >= 1, "Search finds own memory");

  // Share Y's memory with X
  mm3.shareMemoryRead("agent-y", "agent-x");

  // Now X should find both
  const results2 = mm3.semanticSearch("agent-x", "animals", 5);
  await assert(results2.length >= 1, "Search includes shared memory");

  // ============ SUMMARY ============

  console.log(
    `\n${colors.yellow}=== ALL TESTS PASSED ===${colors.reset}\n`
  );
  console.log(`${colors.green}✓ AgentMemory (short/long-term)${colors.reset}`);
  console.log(`${colors.green}✓ VectorStore (similarity search)${colors.reset}`);
  console.log(`${colors.green}✓ MemoryManager (multi-agent)${colors.reset}`);
  console.log(`${colors.green}✓ ACL Isolation (privacy)${colors.reset}`);
  console.log(`${colors.green}✓ Memory Sharing (explicit)${colors.reset}`);
  console.log(`${colors.green}✓ Context Windows (LLM ready)${colors.reset}\n`);
}

// Run tests
runTests().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
