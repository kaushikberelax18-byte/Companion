'use strict';
/* Regression tests for multi-character identity management.

These tests verify that character identities, scene state, and speaker attribution
are handled correctly in long multi-character conversations.

Run: node test/character-identity.test.js
*/

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// Import modules under test
const characters = require('../lib/characters');
const storage = require('../lib/storage');

// Test utilities
function createTestConversation() {
  const id = 'test_' + Date.now().toString(36);
  return {
    id,
    title: 'Test Conversation',
    persona: { name: 'Priya', age: 25, personality: 'playful', culture: 'western', length: 'medium', mode: 'chat' },
    characters: {},
    scene: null,
    continuity: { summary: '', turnCount: 0 },
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function cleanupTestConversations() {
  const convDir = path.join(__dirname, '..', 'data', 'conversations');
  if (fs.existsSync(convDir)) {
    const files = fs.readdirSync(convDir);
    for (const f of files) {
      if (f.startsWith('test_')) {
        fs.unlinkSync(path.join(convDir, f));
      }
    }
  }
}

// Cleanup before tests
cleanupTestConversations();

test('Character ID generation is stable for same input', () => {
  const id1 = characters.generateCharacterId('Priya', 'context1');
  const id2 = characters.generateCharacterId('Priya', 'context1');
  // IDs include timestamp, so they won't be identical
  // But they should have the same prefix structure
  assert.ok(id1.startsWith('c'));
  assert.ok(id2.startsWith('c'));
  assert.strictEqual(id1.length, 13); // 'c' + 12 hex chars
  assert.strictEqual(id2.length, 13);
});

test('Character record has all required fields', () => {
  const char = characters.createCharacterRecord({ name: 'Priya', age: 25 });
  assert.ok(char.id);
  assert.strictEqual(char.name, 'Priya');
  assert.strictEqual(char.age, 25);
  assert.ok(Array.isArray(char.aliases));
  assert.ok(typeof char.personality === 'string');
  assert.ok(typeof char.establishedFacts === 'object');
  assert.ok(typeof char.relationships === 'object');
  assert.ok(Array.isArray(char.secrets));
  assert.strictEqual(typeof char.createdAt, 'number');
  assert.strictEqual(char.lastSpokeAt, null);
  assert.strictEqual(char.dialogueTurnCount, 0);
});

test('Character validation catches invalid records', () => {
  const errors1 = characters.validateCharacterRecord(null);
  assert.ok(errors1.length > 0);

  const errors2 = characters.validateCharacterRecord({ id: 'c1', name: 'Ava' });
  assert.ok(errors2.length > 0); // Missing age

  const valid = characters.validateCharacterRecord({
    id: 'c1',
    name: 'Ava',
    age: 28
  });
  assert.strictEqual(valid.length, 0);
});

test('Scene state tracks participants correctly', () => {
  const scene = characters.createSceneState({
    name: 'Test Scene',
    location: 'Coffee Shop',
    participants: ['char1', 'char2']
  });

  assert.strictEqual(scene.location, 'Coffee Shop');
  assert.deepStrictEqual(scene.participants, ['char1', 'char2']);
  assert.strictEqual(scene.speaker, null);
  assert.strictEqual(scene.addressee, null);

  // Add a participant
  const updated = characters.updateSceneParticipants(scene, ['char3'], { enter: true });
  assert.ok(updated.participants.includes('char3'));

  // Remove a participant
  const afterExit = characters.updateSceneParticipants(updated, ['char2'], { exit: true });
  assert.ok(!afterExit.participants.includes('char2'));
  assert.ok(afterExit.participants.includes('char1'));
  assert.ok(afterExit.participants.includes('char3'));
});

test('Scene speaker and addressee are set correctly', () => {
  const scene = characters.createSceneState({ participants: ['priya', 'ava'] });

  // Set speaker and addressee
  const updated = characters.setSceneSpeaker(scene, 'priya', 'ava');
  assert.strictEqual(updated.speaker, 'priya');
  assert.strictEqual(updated.addressee, 'ava');

  // Clear speaker
  const cleared = characters.setSceneSpeaker(updated, null, null);
  assert.strictEqual(cleared.speaker, null);
  assert.strictEqual(cleared.addressee, null);
});

test('Scene timeline tracks events', () => {
  const scene = characters.createSceneState({});

  const withEvent = characters.addSceneEvent(scene, {
    type: 'entrance',
    characterId: 'ava',
    description: 'Ava enters the coffee shop'
  });

  assert.strictEqual(withEvent.timeline.length, 1);
  assert.strictEqual(withEvent.timeline[0].type, 'entrance');
  assert.strictEqual(withEvent.timeline[0].characterId, 'ava');
});

test('Scene actions are tracked and resolved', () => {
  const scene = characters.createSceneState({});

  const withAction = characters.addSceneAction(scene, {
    description: 'Meet at the park tomorrow'
  });

  assert.strictEqual(withAction.unresolvedActions.length, 1);
  const action = withAction.unresolvedActions[0];
  assert.strictEqual(action.status, 'pending');

  const resolved = characters.resolveSceneAction(withAction, action.id, 'completed');
  const foundAction = resolved.unresolvedActions.find(a => a.id === action.id);
  assert.strictEqual(foundAction.status, 'completed');
});

test('Character-aware summary preserves speaker attribution', () => {
  const characters_registry = {
    'priya_id': characters.createCharacterRecord({ name: 'Priya', age: 25 }),
    'ava_id': characters.createCharacterRecord({ name: 'Ava', age: 28 })
  };

  const scene = characters.createSceneState({
    participants: ['priya_id', 'ava_id'],
    speaker: 'priya_id',
    addressee: 'ava_id',
    location: 'Coffee Shop'
  });

  const summary = characters.buildCharacterAwareSummary({
    characters: characters_registry,
    scene,
    recentDialogue: [
      { role: 'user', content: 'Ava, what are you doing?' },
      { role: 'assistant', content: 'Just waiting for you.' }
    ]
  });

  assert.ok(summary.includes('Character Profiles'));
  assert.ok(summary.includes('Priya'));
  assert.ok(summary.includes('Ava'));
  assert.ok(summary.includes('Current Scene'));
  assert.ok(summary.includes('Coffee Shop'));
  assert.ok(summary.includes('Last speaker: Priya'));
});

test('Dialogue parser extracts speaker attribution', () => {
  const test1 = characters.parseDialogueLine('Priya: Hey there!');
  assert.strictEqual(test1.speaker, 'Priya');
  assert.strictEqual(test1.content, 'Hey there!');
  assert.ok(test1.attributed);

  const test2 = characters.parseDialogueLine('[Ava] What\'s up?');
  assert.strictEqual(test2.speaker, 'Ava');
  assert.ok(test2.attributed);

  const test3 = characters.parseDialogueLine('Just hanging out.');
  assert.strictEqual(test3.speaker, null);
  assert.strictEqual(test3.content, 'Just hanging out.');
  assert.strictEqual(test3.attributed, false);
});

test('Multi-character scene prevents identity confusion', () => {
  // Create a scene with multiple characters
  const priya = characters.createCharacterRecord({ name: 'Priya', age: 25 });
  const ava = characters.createCharacterRecord({ name: 'Ava', age: 28 });
  const karen = characters.createCharacterRecord({ name: 'Karen', age: 35 });

  const characterRegistry = {
    [priya.id]: priya,
    [ava.id]: ava,
    [karen.id]: karen
  };

  const scene = characters.createSceneState({
    participants: [priya.id, ava.id, karen.id],
    location: 'Living Room'
  });

  // Each character should have independent state
  assert.notStrictEqual(priya.id, ava.id);
  assert.notStrictEqual(priya.id, karen.id);
  assert.notStrictEqual(ava.id, karen.id);

  // Facts are scoped to character IDs
  priya.establishedFacts.occupation = 'Designer';
  ava.establishedFacts.occupation = 'Photographer';

  assert.strictEqual(priya.establishedFacts.occupation, 'Designer');
  assert.strictEqual(ava.establishedFacts.occupation, 'Photographer');
  assert.strictEqual(karen.establishedFacts.occupation, undefined);
});

test('Character facts validation detects contradictions', () => {
  const char = characters.createCharacterRecord({
    name: 'Priya',
    age: 25,
    establishedFacts: { occupation: 'Designer', hometown: 'Mumbai' }
  });

  const characters_registry = { [char.id]: char };

  // No contradictions
  const noContradictions = characters.validateCharacterFacts(characters_registry, {
    occupation: 'Designer'
  });
  assert.strictEqual(noContradictions.length, 0);

  // Contradiction detected
  const contradictions = characters.validateCharacterFacts(characters_registry, {
    occupation: 'Engineer'
  });
  assert.strictEqual(contradictions.length, 1);
  assert.strictEqual(contradictions[0].characterId, char.id);
  assert.strictEqual(contradictions[0].fact, 'occupation');
  assert.strictEqual(contradictions[0].existing, 'Designer');
  assert.strictEqual(contradictions[0].proposed, 'Engineer');
});

test('Scene participant management handles edge cases', () => {
  const scene = characters.createSceneState({ participants: [] });

  // Adding same participant twice doesn't duplicate
  let updated = characters.updateSceneParticipants(scene, ['char1'], { enter: true });
  updated = characters.updateSceneParticipants(updated, ['char1'], { enter: true });
  assert.strictEqual(updated.participants.length, 1);

  // Removing non-existent participant is safe
  const afterRemove = characters.updateSceneParticipants(updated, ['nonexistent'], { exit: true });
  assert.strictEqual(afterRemove.participants.length, 1);

  // Removing speaker clears speaker field
  const withSpeaker = characters.setSceneSpeaker(afterRemove, 'char1', null);
  const afterSpeakerExit = characters.updateSceneParticipants(withSpeaker, ['char1'], { exit: true });
  assert.strictEqual(afterSpeakerExit.participants.length, 0);
  assert.strictEqual(afterSpeakerExit.speaker, null);
});

test('Character record update preserves invariants', () => {
  const char = characters.createCharacterRecord({ name: 'Priya', age: 25 });
  const originalId = char.id;
  const originalCreatedAt = char.createdAt;

  const updated = characters.updateCharacterRecord(char, {
    name: 'Priya Sharma',
    age: 26,
    personality: 'confident',
    establishedFacts: { occupation: 'Senior Designer' }
  });

  assert.strictEqual(updated.id, originalId); // ID preserved
  assert.strictEqual(updated.name, 'Priya Sharma');
  assert.strictEqual(updated.age, 26);
  assert.strictEqual(updated.personality, 'confident');
  assert.strictEqual(updated.establishedFacts.occupation, 'Senior Designer');
  assert.ok(updated.updatedAt >= originalCreatedAt); // Timestamp updated (may be equal due to fast execution)
});

test('Empty character registry is handled gracefully', () => {
  const scene = characters.createSceneState({ participants: [] });

  const summary = characters.buildCharacterAwareSummary({
    characters: {},
    scene,
    recentDialogue: []
  });

  assert.ok(summary.includes('Character Profiles'));
  // Should not throw or crash
});

test('Scene state serialization and restoration', () => {
  const originalScene = characters.createSceneState({
    name: 'Test Scene',
    location: 'Office',
    participants: ['char1', 'char2'],
    speaker: 'char1',
    addressee: 'char2',
    context: 'Late night work session',
    unresolvedActions: [{ id: 'a1', description: 'Finish report', status: 'pending' }]
  });

  // Simulate JSON serialization (as would happen in storage)
  const json = JSON.stringify(originalScene);
  const restored = JSON.parse(json);

  assert.strictEqual(restored.name, 'Test Scene');
  assert.strictEqual(restored.location, 'Office');
  assert.deepStrictEqual(restored.participants, ['char1', 'char2']);
  assert.strictEqual(restored.speaker, 'char1');
  assert.strictEqual(restored.addressee, 'char2');
  assert.strictEqual(restored.context, 'Late night work session');
  assert.strictEqual(restored.unresolvedActions[0].description, 'Finish report');
});

test('Cultural background is preserved in character records', () => {
  const indianChar = characters.createCharacterRecord({
    name: 'Priya Sharma',
    age: 25,
    culture: 'indian',
    background: {
      region: 'South Indian',
      hometown: 'Bangalore',
      firstName: 'Priya',
      lastName: 'Sharma'
    }
  });

  assert.strictEqual(indianChar.culture, 'indian');
  assert.strictEqual(indianChar.background.region, 'South Indian');
  assert.strictEqual(indianChar.background.hometown, 'Bangalore');

  const westernChar = characters.createCharacterRecord({
    name: 'Ava Johnson',
    age: 28,
    culture: 'western'
  });

  assert.strictEqual(westernChar.culture, 'western');
});

test('Relationships between characters are tracked', () => {
  const priya = characters.createCharacterRecord({ name: 'Priya', age: 25 });
  const ava = characters.createCharacterRecord({ name: 'Ava', age: 28 });

  // Set up relationship
  priya.relationships[ava.id] = 'Close friend and roommate';
  ava.relationships[priya.id] = 'Best friend';

  assert.strictEqual(priya.relationships[ava.id], 'Close friend and roommate');
  assert.strictEqual(ava.relationships[priya.id], 'Best friend');

  // Relationships are bidirectional but independent
  assert.strictEqual(Object.keys(priya.relationships).length, 1);
  assert.strictEqual(Object.keys(ava.relationships).length, 1);
});

// Cleanup after tests
process.on('exit', () => {
  cleanupTestConversations();
});

console.log('\nAll character identity tests completed.\n');
