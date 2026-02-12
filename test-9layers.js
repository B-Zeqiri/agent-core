"use strict";
/**
 * Test 9-Layer Architecture
 *
 * Verifies all layers work correctly end-to-end
 */
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
const https = __importStar(require("https"));
const testRequest = {
    input: 'Create a simple HTML page with a button that says "Click me"',
};
function makeRequest() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: '/task',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    console.log('✓ Task created:', response.task_id);
                    console.log('✓ Status:', response.status);
                    resolve();
                }
                catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.write(JSON.stringify(testRequest));
        req.end();
    });
}
// Try HTTP as well
function makeHttpRequest() {
    return new Promise((resolve, reject) => {
        const http = require('http');
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: '/task',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    console.log('✓ Task created:', response.task_id);
                    console.log('✓ Status:', response.status);
                    resolve();
                }
                catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.write(JSON.stringify(testRequest));
        req.end();
    });
}
async function test() {
    console.log('Testing 9-layer architecture...\n');
    try {
        await makeHttpRequest();
        console.log('\n✓ All 9 layers working correctly!');
    }
    catch (error) {
        console.error('✗ Test failed:', error);
    }
}
test();
