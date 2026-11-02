# How to run the Companion

This is a two-part app: a Node server that talks to your FreeLLMAPI proxy, and a
browser interface that talks to the server. No install step, no dependencies
beyond Node (already installed).

## 1. Start the server

Open a terminal (PowerShell or Command Prompt) and run:

```
cd "D:\03 - Projects\companion"
node server.js
```

You should see:

```
companion  ->  http://127.0.0.1:8787
upstream   ->  http://127.0.0.1:31415/v1/messages  (model auto:default, key from claude-settings)
```

The `key from claude-settings` line means it found your API key in
`C:\Users\K24\.claude\settings.json` — the same key your Claude Desktop uses.
If it says `key from none`, no key was found and nothing will work; paste one
in the Settings panel.

Keep that terminal open while you use the app. The server must keep running.

## 2. Open the interface

Open this URL in any browser:

```
http://127.0.0.1:8787
```

That is the only URL. The page loads, the companion opens the conversation
herself, and you can start typing immediately.

## 3. Start chatting

Type in the box at the bottom and press **Enter** (Shift+Enter for a new line).
Send the first thing that comes to mind — she opens conversations her own way.

## 4. Change her age and personality

The right-hand panel has clickable chips:

- **Age** — 21, 25, 30, 35, 40, 45. Changes her vocabulary, references, maturity
  and flirting style. Changing it does **not** erase the conversation.
- **Personality** — Playful, Dominant, Sweet, Sarcastic, Confident, Shy but bold,
  Romantic, Adventurous.
- **Conversation mode** — Everyday, Flirtation, Romance, Adult, Roleplay, Open.
- **Length** — Short, Medium, Detailed.
- **Initiative** — Reactive, Balanced, Proactive.
- **Language style** — Clean, Casual, Edgy, Profane.
- **Creativity** — Grounded, Spontaneous.

Clicking **Restart scene** re-opens the conversation with the current persona
while keeping your messages. Click it again to confirm if the persona changed
since the last message.

## 5. Configure the API

Click the **gear icon** (top right) or press **Ctrl+K**. You can set:

- **Base URL** — leave as `http://127.0.0.1:31415` (your FreeLLMAPI proxy).
- **API key** — leave blank to keep the one already in use. Paste one only if
  you want to override it.
- **Model** — `auto:default` is recommended. A dropdown lists every model the
  proxy advertises.
- **Context budget** — how much conversation history to keep before it gets
  compressed automatically.
- **Her name** — changes the name shown in the chat.

Click **Test connection** before **Save** to verify the settings work.

## 6. History and new conversations

- **New conversation** (left rail) starts a fresh chat with the current persona.
- The left rail lists every conversation; click one to switch, click the trash
  icon to delete it.
- **Compact memory** (top bar) folds older messages into a continuity summary
  when a conversation gets long.

## 7. Stop and restart

To stop the server, press **Ctrl+C** in the terminal where you ran
`node server.js`. To start again, repeat step 1. Conversations and settings are
saved as files in `D:\03 - Projects\companion\data\` and survive restarts.

## What is verified working

- Server starts and serves the interface at `http://127.0.0.1:8787`.
- Messages reach the real FreeLLMAPI proxy at `http://127.0.0.1:31415` and
  genuine model replies appear in the chat (verified with live requests).
- The configured model `auto:default` is used; the app detects and warns if a
  requested model is silently replaced by a different one.
- Conversation continuity holds across many messages (names, age, projects and
  earlier details are remembered).
- Changing age/personality/mode updates the style while preserving history.
- Settings and conversations persist to disk across restarts.
- Error messages are shown for: missing conversation, empty message, bad API
  key, rate limits, unreachable proxy, context limits and unknown models.

## Known limitations

- Streaming is not supported by the FreeLLMAPI proxy, so replies arrive as a
  single block after the model finishes. This is detected and handled, not a bug.
- The proxy silently falls back to a different model for unknown model IDs; the
  app warns you instead of pretending the request used your chosen model.
- Some free-routed models occasionally leak an internal "thinking process"
  block into their reply. The app strips that out automatically (see below), so
  you only ever see the conversational reply. If you ever see raw reasoning,
  it means the strip missed something — tell me and I will widen the filter.

## Internal reasoning is stripped automatically

The models behind FreeLLMAPI sometimes output an internal "thinking process"
block — numbered analysis, constraint checks, policy evaluations — before or
after the real reply. The app removes that and shows only the conversational
answer. It is enforced three ways: the system prompt forbids it outright, the
reply is stripped of any leaked reasoning, and the request uses a generous
token budget so a leaked block cannot truncate the real reply.

Tests: `node test_strip.js` runs the reply-stripping unit tests, and
`node test_api.js` runs live tests against the real proxy.