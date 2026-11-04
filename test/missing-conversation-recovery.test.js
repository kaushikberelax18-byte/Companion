'use strict';
/* Test for missing conversation recovery in createConversation.

Verifies that:
1. createConversation creates a valid conversation structure
2. createConversation with custom persona applies overrides
3. The conversation is properly persisted to storage
4. Existing conversations are never overwritten
*/
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const storage = require('../lib/storage');
const { createConversation } = require('../server.js');

describe('Missing conversation recovery', () => {
  // Clean up before tests
  function cleanupTestConversations() {
    const convDir = path.join(__dirname, '..', 'data', 'conversations');
    if (fs.existsSync(convDir)) {
      const files = fs.readdirSync(convDir);
      for (const f of files) {
        if (f.startsWith('test_') || f.startsWith('recovery_')) {
          fs.unlinkSync(path.join(convDir, f));
        }
      }
    }
  }

  // We need to reset storage to file backend
  storage.__setClient(null);

  cleanupTestConversations();

  test('createConversation creates valid conversation structure', async () => {
    const conv = await createConversation();
    assert.ok(conv.id);
    assert.ok(conv.id.startsWith('c'));
    assert.strictEqual(conv.title, '');
    assert.ok(conv.createdAt);
    assert.ok(conv.updatedAt);
    assert.ok(conv.persona);
    assert.ok(conv.persona.age);
    assert.ok(conv.persona.personality);
    assert.ok(conv.messages);
    assert.strictEqual(conv.messages.length, 0);
    assert.ok(conv.characters);
    assert.ok(Object.keys(conv.characters).length > 0);
    assert.ok(conv.scene);
    assert.ok(conv.continuity);
  });

  test('createConversation with custom persona', async () => {
    const conv = await createConversation({ age: 30, personality: 'confident', mode: 'adult' });
    assert.strictEqual(conv.persona.age, 30);
    assert.strictEqual(conv.persona.personality, 'confident');
    assert.strictEqual(conv.persona.mode, 'adult');
  });

  test('Created conversation is persisted to storage', async () => {
    const conv = await createConversation({ personality: 'playful' });
    const loaded = await storage.loadConv(conv.id);
    assert.ok(loaded);
    assert.strictEqual(loaded.id, conv.id);
    assert.strictEqual(loaded.persona.personality, 'playful');
  });

  test('Existing conversation is preserved and not overwritten', async () => {
    // Create a conversation
    const existing = await createConversation({ age: 25, personality: 'playful' });
    const existingId = existing.id;
    // Add a message to it
    existing.messages.push({ role: 'user', content: 'Test message', at: Date.now() });
    await storage.saveConv(existing);

    // Verify it exists
    const loaded = await storage.loadConv(existingId);
    assert.ok(loaded);
    assert.strictEqual(loaded.messages.length, 1);

    // Create another conversation - should NOT affect existing
    const another = await createConversation({ age: 30, personality: 'confident' });
    assert.notStrictEqual(another.id, existingId);

    // Existing conversation should still have its message
    const loadedAgain = await storage.loadConv(existingId);
    assert.ok(loadedAgain);
    assert.strictEqual(loadedAgain.messages.length, 1);
    assert.strictEqual(loadedAgain.messages[0].content, 'Test message');
  });

  test('Recovery conversation is saved and can be retrieved via listConvs', async () => {
    const conv = await createConversation({ personality: 'romantic' });
    const list = await storage.listConvs();
    const found = list.find(c => c.id === conv.id);
    assert.ok(found);
    assert.strictEqual(found.id, conv.id);
  });
});

console.log('\nMissing conversation recovery tests completed.\n');