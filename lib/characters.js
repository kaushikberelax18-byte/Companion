'use strict';
/* Character identity and scene state management.

This module provides structured, validated state management for multi-character
conversations. It separates:
1. Character registry: stable identity records with unique IDs
2. Scene state: who is present, speaking, and where
3. Continuity memory: character-aware summaries with speaker attribution
4. Relationship graph: explicit connections between characters

Exported functions maintain invariants:
- Every character has a stable ID independent of display name
- Facts are scoped to character IDs, not merged globally
- Scene state is explicit, not implicit in dialogue
- Summaries preserve speaker attribution
*/

/* Generate a stable character ID from name + context, or random if unnamed */
function generateCharacterId(name, context = '') {
  const base = (name || 'char') + ':' + context + ':' + Date.now();
  return 'c' + require('crypto').createHash('md5').update(base).digest('hex').slice(0, 12);
}

/* Create a new character record with full structured state */
function createCharacterRecord({
  id = null,
  name,
  aliases = [],
  age = 25,
  isAdult = true,
  personality = 'playful',
  secondaryTrait = '',
  culture = 'western',
  background = {},
  relationships = {},
  emotionalState = 'neutral',
  location = 'unknown',
  sceneRole = 'companion',
  establishedFacts = {},
  secrets = [],
  speakingStyle = {},
  metadata = {}
}) {
  const charId = id || generateCharacterId(name, Date.now().toString());

  return {
    id: charId,
    // Identity
    name: String(name || 'Unknown'),
    aliases: Array.isArray(aliases) ? aliases : [],

    // Demographics
    age: Number(age) || 25,
    isAdult: Boolean(isAdult),

    // Personality
    personality: String(personality || 'playful'),
    secondaryTrait: String(secondaryTrait || ''),
    culture: String(culture || 'western'),

    // Background (scoped to this character)
    background: {
      occupation: background.occupation || '',
      hometown: background.hometown || '',
      family: background.family || [],
      history: background.history || [],
      ...background
    },

    // Relationships (map of characterId -> relationship description)
    relationships: typeof relationships === 'object' ? relationships : {},

    // Current state
    emotionalState: String(emotionalState || 'neutral'),
    location: String(location || 'unknown'),
    sceneRole: String(sceneRole || 'companion'),

    // Established facts (scoped to this character)
    establishedFacts: typeof establishedFacts === 'object' ? establishedFacts : {},

    // Secrets (to be revealed naturally)
    secrets: Array.isArray(secrets) ? secrets : [],

    // Speaking style overrides
    speakingStyle: typeof speakingStyle === 'object' ? speakingStyle : {},

    // Metadata
    metadata: typeof metadata === 'object' ? metadata : {},

    // Tracking
    createdAt: Date.now(),
    updatedAt: Date.now(),
    firstSeenAt: Date.now(),
    lastSpokeAt: null,
    dialogueTurnCount: 0
  };
}

/* Validate a character record has required fields */
function validateCharacterRecord(char) {
  const errors = [];
  if (!char || typeof char !== 'object') {
    errors.push('Character must be an object');
    return errors;
  }
  if (!char.id || typeof char.id !== 'string') {
    errors.push('Character must have a string id');
  }
  if (!char.name || typeof char.name !== 'string') {
    errors.push('Character must have a string name');
  }
  if (typeof char.age !== 'number' || char.age < 18) {
    errors.push('Character age must be a number >= 18');
  }
  return errors;
}

/* Merge updated fields into a character record, preserving invariants */
function updateCharacterRecord(char, updates) {
  if (!char || !char.id) return char;

  const allowedUpdates = [
    'name', 'aliases', 'age', 'personality', 'secondaryTrait', 'culture',
    'background', 'emotionalState', 'location', 'sceneRole',
    'establishedFacts', 'secrets', 'speakingStyle', 'metadata'
  ];

  for (const key of allowedUpdates) {
    if (updates[key] !== undefined) {
      if (typeof updates[key] === 'object' && updates[key] !== null) {
        char[key] = { ...(char[key] || {}), ...updates[key] };
      } else {
        char[key] = updates[key];
      }
    }
  }

  char.updatedAt = Date.now();
  return char;
}

/* Scene registry: track who is present, speaking, and where */
function createSceneState({
  id = null,
  name = 'Default Scene',
  location = 'unspecified',
  participants = [],
  speaker = null,
  addressee = null,
  context = '',
  activeThreads = [],
  unresolvedActions = [],
  timeline = []
}) {
  return {
    id: id || 'scene_' + Date.now(),
    name: String(name),
    location: String(location),

    // Participant character IDs
    participants: Array.isArray(participants) ? [...participants] : [],

    // Current speaker character ID (who last spoke)
    speaker: speaker || null,

    // Intended addressee character ID (who is being spoken to)
    addressee: addressee || null,

    // Scene context description
    context: String(context || ''),

    // Active conversation threads [{id, topic, participants, lastActive}]
    activeThreads: Array.isArray(activeThreads) ? [...activeThreads] : [],

    // Unresolved actions/promises [{description, who, when, status}]
    unresolvedActions: Array.isArray(unresolvedActions) ? [...unresolvedActions] : [],

    // Timeline of events [{at, type, characterId, description}]
    timeline: Array.isArray(timeline) ? [...timeline] : [],

    updatedAt: Date.now()
  };
}

/* Add or update a participant in the scene */
function updateSceneParticipants(scene, characterIds, options = {}) {
  const { enter = true, exit = false, location = null } = options;
  const ids = Array.isArray(characterIds) ? characterIds : [characterIds];

  if (exit) {
    // Remove characters from scene
    scene.participants = scene.participants.filter(id => !ids.includes(id));
    if (scene.speaker && ids.includes(scene.speaker)) {
      scene.speaker = null;
    }
    if (scene.addressee && ids.includes(scene.addressee)) {
      scene.addressee = null;
    }
  } else if (enter) {
    // Add characters to scene
    for (const id of ids) {
      if (!scene.participants.includes(id)) {
        scene.participants.push(id);
      }
    }
  }

  // Update location if specified
  if (location) {
    scene.location = location;
    // Update character locations too (caller must pass characterRecords)
  }

  scene.updatedAt = Date.now();
  return scene;
}

/* Set the current speaker in the scene */
function setSceneSpeaker(scene, characterId, addresseeId = null) {
  if (characterId && !scene.participants.includes(characterId)) {
    // Speaker not in scene - add them
    scene.participants.push(characterId);
  }
  scene.speaker = characterId || null;
  scene.addressee = addresseeId || null;
  scene.updatedAt = Date.now();
  return scene;
}

/* Add an event to the scene timeline */
function addSceneEvent(scene, event) {
  scene.timeline.push({
    at: Date.now(),
    type: event.type || 'unknown',
    characterId: event.characterId || null,
    description: String(event.description || '')
  });
  // Keep timeline bounded
  if (scene.timeline.length > 50) {
    scene.timeline = scene.timeline.slice(-50);
  }
  scene.updatedAt = Date.now();
  return scene;
}

/* Add or resolve an action item */
function addSceneAction(scene, action) {
  scene.unresolvedActions.push({
    id: 'action_' + Date.now(),
    description: String(action.description),
    who: action.who || null,
    when: Date.now(),
    status: 'pending'
  });
  scene.updatedAt = Date.now();
  return scene;
}

function resolveSceneAction(scene, actionId, status = 'completed') {
  const action = scene.unresolvedActions.find(a => a.id === actionId);
  if (action) {
    action.status = status;
  }
  scene.updatedAt = Date.now();
  return scene;
}

/* Character-aware continuity summary builder */
function buildCharacterAwareSummary({
  characters = {},
  scene = null,
  recentDialogue = [],
  existingMemory = ''
}) {
  const lines = [];

  // Character profiles section
  lines.push('## Character Profiles');
  for (const [charId, char] of Object.entries(characters)) {
    lines.push(`\n### ${char.name} (${charId})`);
    lines.push(`- Age: ${char.age}, Personality: ${char.personality}`);
    if (char.culture && char.culture !== 'western') {
      lines.push(`- Cultural background: ${char.culture}`);
    }
    if (char.background && Object.keys(char.background).length) {
      const facts = [];
      if (char.background.occupation) facts.push(`works as ${char.background.occupation}`);
      if (char.background.hometown) facts.push(`from ${char.background.hometown}`);
      if (facts.length) lines.push(`- Background: ${facts.join(', ')}`);
    }
    if (char.establishedFacts && Object.keys(char.establishedFacts).length) {
      for (const [key, value] of Object.entries(char.establishedFacts)) {
        lines.push(`- ${key}: ${value}`);
      }
    }
    if (char.secrets && char.secrets.length) {
      lines.push(`- Secrets (reveal naturally): ${char.secrets.slice(0, 3).join('; ')}`);
    }
  }

  // Scene state section
  if (scene && scene.participants.length) {
    lines.push('\n## Current Scene');
    lines.push(`Location: ${scene.location || 'unspecified'}`);
    const participantNames = scene.participants
      .map(id => characters[id] ? characters[id].name : id)
      .join(', ');
    lines.push(`Present: ${participantNames}`);
    if (scene.speaker) {
      const speakerName = characters[scene.speaker] ? characters[scene.speaker].name : scene.speaker;
      lines.push(`Last speaker: ${speakerName}`);
    }
    if (scene.context) {
      lines.push(`Context: ${scene.context}`);
    }
  }

  // Relationship graph
  const relationships = [];
  for (const [charId, char] of Object.entries(characters)) {
    if (char.relationships && Object.keys(char.relationships).length) {
      for (const [otherId, rel] of Object.entries(char.relationships)) {
        const otherName = characters[otherId] ? characters[otherId].name : otherId;
        relationships.push(`${char.name} -> ${otherName}: ${rel}`);
      }
    }
  }
  if (relationships.length) {
    lines.push('\n## Relationships');
    lines.push(...relationships);
  }

  // Unresolved actions
  if (scene && scene.unresolvedActions.filter(a => a.status === 'pending').length) {
    lines.push('\n## Unresolved');
    for (const action of scene.unresolvedActions) {
      if (action.status === 'pending') {
        const whoStr = action.who ? (characters[action.who] ? characters[action.who].name : action.who) : 'someone';
        lines.push(`- ${action.description} (${whoStr})`);
      }
    }
  }

  // Existing memory (preserved)
  if (existingMemory) {
    lines.push('\n## Continuity Memory');
    lines.push(existingMemory);
  }

  return lines.join('\n');
}

/* Parse dialogue line to extract speaker attribution if present */
function parseDialogueLine(line) {
  // Match patterns like "Karen: text" or "Karen said:" or "[Karen] text"
  const patterns = [
    /^(\w+):\s*(.+)$/,
    /^\[(\w+)\]\s*(.+)$/,
    /^(\w+)\s+said:\s*(.+)$/i,
    /^(\w+)\s+asks:\s*(.+)$/i,
    /^(\w+)\s+replies:\s*(.+)$/i
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      return {
        speaker: match[1],
        content: match[2].trim(),
        attributed: true
      };
    }
  }

  return {
    speaker: null,
    content: line,
    attributed: false
  };
}

/* Build character-aware dialogue history for context */
function buildDialogueContext({
  characters = {},
  messages = [],
  maxMessages = 20
}) {
  const recent = messages.slice(-maxMessages);
  const lines = [];

  for (const msg of recent) {
    if (msg.role === 'user') {
      lines.push(`USER: ${msg.content}`);
    } else if (msg.role === 'assistant') {
      // Try to parse speaker attribution
      const parsed = parseDialogueLine(msg.content.split('\n')[0]);
      if (parsed.attributed && parsed.speaker) {
        // Find matching character
        const charMatch = Object.values(characters).find(
          c => c.name.toLowerCase() === parsed.speaker.toLowerCase() ||
               c.aliases.some(a => a.toLowerCase() === parsed.speaker.toLowerCase())
        );
        const speakerName = charMatch ? charMatch.name : parsed.speaker;
        lines.push(`${speakerName}: ${parsed.content}`);
        if (msg.content.includes('\n')) {
          // Multi-line response, might have more attributed dialogue
          const remainingLines = msg.content.split('\n').slice(1);
          for (const line of remainingLines) {
            const innerParsed = parseDialogueLine(line);
            if (innerParsed.attributed) {
              const innerChar = Object.values(characters).find(
                c => c.name.toLowerCase() === innerParsed.speaker.toLowerCase()
              );
              const innerName = innerChar ? innerChar.name : innerParsed.speaker;
              lines.push(`${innerName}: ${innerParsed.content}`);
            } else if (line.trim()) {
              lines.push(line);
            }
          }
        }
      } else {
        lines.push(`ASSISTANT: ${msg.content}`);
      }
    }
  }

  return lines.join('\n');
}

/* Validate that character facts haven't been contradicted */
function validateCharacterFacts(characters, newFacts) {
  const contradictions = [];

  for (const [charId, char] of Object.entries(characters)) {
    for (const [key, value] of Object.entries(newFacts)) {
      if (char.establishedFacts[key] !== undefined) {
        // Normalize for comparison
        const existing = String(char.establishedFacts[key]).toLowerCase();
        const proposed = String(value).toLowerCase();
        if (existing !== proposed && !existing.includes(proposed) && !proposed.includes(existing)) {
          contradictions.push({
            characterId: charId,
            characterName: char.name,
            fact: key,
            existing: char.establishedFacts[key],
            proposed: value
          });
        }
      }
    }
  }

  return contradictions;
}

/* Extract character state from model response for persistence */
function extractStateFromResponse(response, currentState) {
  // This is a placeholder - in production, you'd use structured output
  // or careful parsing to extract state changes from the response
  // For now, we return the current state unchanged
  return currentState;
}

module.exports = {
  // Character management
  generateCharacterId,
  createCharacterRecord,
  validateCharacterRecord,
  updateCharacterRecord,

  // Scene management
  createSceneState,
  updateSceneParticipants,
  setSceneSpeaker,
  addSceneEvent,
  addSceneAction,
  resolveSceneAction,

  // Continuity
  buildCharacterAwareSummary,
  buildDialogueContext,

  // Validation
  parseDialogueLine,
  validateCharacterFacts,
  extractStateFromResponse
};