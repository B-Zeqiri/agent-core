"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const app = (0, express_1.default)();
app.use(express_1.default.json());
console.log("Starting simple test server...");
app.post("/test", (req, res) => {
    console.log("POST /test called");
    try {
        const input = req.body?.input || "";
        console.log("Got input:", input);
        res.status(202).json({ id: "test-123" });
        // Fire async operation
        setImmediate(async () => {
            console.log("Async operation starting...");
            await new Promise(r => setTimeout(r, 1000));
            console.log("Async operation done");
        });
    }
    catch (err) {
        console.error("Error in handler:", err);
        res.status(500).json({ error: String(err) });
    }
});
app.listen(3001, () => {
    console.log("Simple test server listening on 3001");
});
process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason);
});
process.on('uncaughtException', (error) => {
    console.error('[UNCAUGHT EXCEPTION]', error);
});
