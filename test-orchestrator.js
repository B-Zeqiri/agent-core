"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const orchestrator_1 = require("./src/orchestration/orchestrator");
const kernel_1 = require("./src/kernel/kernel");
const webDevAgent_1 = require("./src/agents/webDevAgent");
async function test() {
    try {
        console.log("Starting orchestrator test with OpenAI...");
        const kernel = new kernel_1.Kernel();
        const orchestrator = new orchestrator_1.Orchestrator();
        // Create agent with OpenAI handler
        const testAgent = {
            id: "web-dev-agent",
            name: "Web Dev Agent",
            model: "local",
            state: "uninitialized",
            handler: async (input) => {
                console.log("Agent handler called with input length:", input.length);
                try {
                    let userQuery = input;
                    try {
                        const parsed = JSON.parse(input);
                        userQuery = parsed.query || input;
                    }
                    catch {
                        userQuery = input;
                    }
                    console.log("Querying gpt4all with:", userQuery.substring(0, 50));
                    const { OpenAI } = await Promise.resolve().then(() => __importStar(require("openai")));
                    const client = new OpenAI({
                        baseURL: "http://localhost:4891/v1",
                        apiKey: "not-used",
                    });
                    const response = await client.chat.completions.create({
                        model: "gpt4all",
                        messages: [
                            {
                                role: "system",
                                content: webDevAgent_1.webDevAgent.systemPrompt,
                            },
                            {
                                role: "user",
                                content: userQuery,
                            },
                        ],
                        temperature: 0.7,
                        max_tokens: 2000,
                    });
                    const output = response.choices[0]?.message?.content || "No response";
                    console.log("Got response from gpt4all");
                    return output;
                }
                catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    console.error("Agent error:", msg);
                    throw new Error(`Agent handler error: ${msg}`);
                }
            },
            metadata: {
                capabilities: ["code-generation"],
                version: "1.0.0",
            },
        };
        console.log("Registering agent...");
        kernel.registerAgent(testAgent);
        orchestrator.registerAgent(testAgent);
        kernel.startAgent(testAgent.id);
        console.log("Creating workflow...");
        const task = {
            id: "test-task",
            type: "atomic",
            name: "Test Task",
            agentId: "web-dev-agent",
            input: { query: "What is TypeScript in one sentence?" },
        };
        const workflowId = orchestrator.createWorkflow("test-workflow", "Test Workflow", task).id;
        console.log("Executing workflow...");
        const execution = await orchestrator.executeWorkflow(workflowId);
        console.log("\nWorkflow completed:");
        console.log("Status:", execution.status);
        console.log("Output:", execution.result?.output?.substring(0, 100));
        console.log("Error:", execution.error);
        process.exit(0);
    }
    catch (error) {
        console.error("Test error:", error);
        process.exit(1);
    }
}
test();
