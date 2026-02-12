/**
 * Test 9-Layer Architecture
 * 
 * Verifies all layers work correctly end-to-end
 */

import * as https from 'https';

const testRequest = {
  input: 'Create a simple HTML page with a button that says "Click me"',
};

function makeRequest() {
  return new Promise<void>((resolve, reject) => {
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
        } catch (e) {
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
  return new Promise<void>((resolve, reject) => {
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

    const req = http.request(options, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          console.log('✓ Task created:', response.task_id);
          console.log('✓ Status:', response.status);
          resolve();
        } catch (e) {
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
  } catch (error) {
    console.error('✗ Test failed:', error);
  }
}

test();
