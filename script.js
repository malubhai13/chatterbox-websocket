/**
 * Chatterbox — Frontend Script
 * Pure Vanilla JavaScript. No frameworks.
 *
 * Responsibilities:
 *   - Modal: collect username + room, then open WebSocket
 *   - WebSocket: send/receive JSON events
 *   - UI: render messages, system notices, typing indicators
 *   - Rooms: switch rooms via sidebar, clear message area
 */

"use strict";

/* ══════════════════════════════════════════════
   STATE
══════════════════════════════════════════════ */
const state = {
  socket: null,
  username: "",
  currentRoom: "General",
  typingTimer: null,       // debounce timer for stop_typing
  isTyping: false,         // track if we've sent a "typing" event
  typingUsers: new Set(),  // track who is typing in current room
  unread: {                // unread counts per room
    General: 0,
    Tech: 0,
    Fun: 0,
  },
};

/* ══════════════════════════════════════════════
   DOM REFERENCES
══════════════════════════════════════════════ */
const $ = (id) => document.getElementById(id);

const dom = {
  modalOverlay:      $("modal-overlay"),
  app:               $("app"),
  usernameInput:     $("username-input"),
  roomSelectModal:   $("room-select-modal"),
  joinBtn:           $("join-btn"),
  modalError:        $("modal-error"),

  messages:          $("messages"),
  messageInput:      $("message-input"),
  sendBtn:           $("send-btn"),

  typingIndicator:   $("typing-indicator"),
  typingText:        $("typing-text"),

  headerRoomName:    $("header-room-name"),
  headerRoomIcon:    $("header-room-icon"),
  headerStatus:      $("header-status"),
  connectionDot:     $("connection-dot"),
  connectionLabel:   $("connection-label"),

  sidebarUsername:   $("sidebar-username"),
  userAvatar:        $("user-avatar"),
};

const ROOM_ICONS = { General: "💬", Tech: "💻", Fun: "🎉" };

/* ══════════════════════════════════════════════
   MODAL — JOIN
══════════════════════════════════════════════ */
dom.joinBtn.addEventListener("click", handleJoin);
dom.usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleJoin();
});

function handleJoin() {
  const username = dom.usernameInput.value.trim();
  const room = dom.roomSelectModal.value;

  if (!username) {
    dom.modalError.textContent = "Please enter your name.";
    dom.usernameInput.focus();
    return;
  }
  if (username.length < 2) {
    dom.modalError.textContent = "Name must be at least 2 characters.";
    return;
  }

  dom.modalError.textContent = "";
  state.username = username;
  state.currentRoom = room;

  openApp();
  connectWebSocket(username, room);
}

/* ══════════════════════════════════════════════
   APP — OPEN UI
══════════════════════════════════════════════ */
function openApp() {
  dom.modalOverlay.classList.add("hidden");
  dom.app.classList.remove("hidden");

  // Set sidebar user info
  dom.sidebarUsername.textContent = state.username;
  dom.userAvatar.textContent = state.username.charAt(0).toUpperCase();

  // Highlight correct room button
  setActiveRoomBtn(state.currentRoom);
  updateHeader(state.currentRoom);

  // Focus input
  dom.messageInput.focus();
}

/* ══════════════════════════════════════════════
   WEBSOCKET
══════════════════════════════════════════════ */
function connectWebSocket(username, room) {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = `${protocol}://${location.host}/ws`;

  state.socket = new WebSocket(wsUrl);

  state.socket.addEventListener("open", () => {
    setConnectionStatus(true);

    // Send join event immediately after connection
    sendEvent({ type: "join", username, room });
  });

  state.socket.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data);
      handleIncoming(data);
    } catch (err) {
      console.error("Failed to parse message:", err);
    }
  });

  state.socket.addEventListener("close", () => {
    setConnectionStatus(false);
    appendSystemMessage("Connection lost. Please refresh to reconnect.");
  });

  state.socket.addEventListener("error", (err) => {
    console.error("WebSocket error:", err);
    setConnectionStatus(false);
  });
}

/**
 * Send a structured JSON event to the server.
 */
function sendEvent(data) {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(data));
  }
}

/* ══════════════════════════════════════════════
   INCOMING EVENT HANDLER
══════════════════════════════════════════════ */
function handleIncoming(data) {
  const { type } = data;

  switch (type) {
    case "chat":
      appendChatMessage(data);
      break;

    case "system":
      appendSystemMessage(data.message);
      break;

    case "typing":
      state.typingUsers.add(data.username);
      renderTypingIndicator();
      break;

    case "stop_typing":
      state.typingUsers.delete(data.username);
      renderTypingIndicator();
      break;

    default:
      console.warn("Unknown event type:", type);
  }
}

/* ══════════════════════════════════════════════
   SEND CHAT MESSAGE
══════════════════════════════════════════════ */
dom.sendBtn.addEventListener("click", sendMessage);
dom.messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function sendMessage() {
  const text = dom.messageInput.value.trim();
  if (!text) return;

  sendEvent({ type: "chat", message: text });

  dom.messageInput.value = "";
  dom.messageInput.focus();

  // Stop typing when message is sent
  clearTyping();
}

/* ══════════════════════════════════════════════
   TYPING INDICATOR — OUTGOING
══════════════════════════════════════════════ */
dom.messageInput.addEventListener("input", handleTypingInput);

function handleTypingInput() {
  if (!state.isTyping) {
    state.isTyping = true;
    sendEvent({ type: "typing" });
  }

  // Reset debounce timer
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(clearTyping, 2000);
}

function clearTyping() {
  if (state.isTyping) {
    state.isTyping = false;
    sendEvent({ type: "stop_typing" });
  }
  clearTimeout(state.typingTimer);
  state.typingTimer = null;
}

/* ══════════════════════════════════════════════
   TYPING INDICATOR — INCOMING (render)
══════════════════════════════════════════════ */
function renderTypingIndicator() {
  const users = [...state.typingUsers];
  if (users.length === 0) {
    dom.typingIndicator.classList.add("hidden");
    dom.typingText.textContent = "";
    return;
  }

  dom.typingIndicator.classList.remove("hidden");

  if (users.length === 1) {
    dom.typingText.textContent = `${users[0]} is typing…`;
  } else if (users.length === 2) {
    dom.typingText.textContent = `${users[0]} and ${users[1]} are typing…`;
  } else {
    dom.typingText.textContent = "Several people are typing…";
  }
}

/* ══════════════════════════════════════════════
   ROOM SWITCHING — SIDEBAR
══════════════════════════════════════════════ */
document.querySelectorAll(".room-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const newRoom = btn.dataset.room;
    if (newRoom === state.currentRoom) return;

    switchRoom(newRoom);
  });
});

function switchRoom(newRoom) {
  // Stop typing in old room
  clearTyping();
  state.typingUsers.clear();
  renderTypingIndicator();

  sendEvent({ type: "switch_room", room: newRoom });

  state.currentRoom = newRoom;
  clearMessages();
  setActiveRoomBtn(newRoom);
  updateHeader(newRoom);

  // Clear unread badge for newly active room
  state.unread[newRoom] = 0;
  updateBadge(newRoom);

  dom.messageInput.focus();
}

/* ══════════════════════════════════════════════
   UI HELPERS
══════════════════════════════════════════════ */

/**
 * Render a chat message bubble.
 * @param {{ username: string, message: string, timestamp: string }} data
 */
function appendChatMessage(data) {
  const isSelf = data.username === state.username;
  const wrapper = document.createElement("div");
  wrapper.className = `msg-wrapper ${isSelf ? "self" : "other"}`;

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  if (!isSelf) {
    meta.innerHTML = `<span class="msg-author">${escapeHtml(data.username)}</span>`;
  }
  meta.innerHTML += `<span>${data.timestamp}</span>`;

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.textContent = data.message;

  wrapper.appendChild(meta);
  wrapper.appendChild(bubble);

  removeWelcome();
  dom.messages.appendChild(wrapper);
  scrollToBottom();
}

/**
 * Render a system notification (italic, centered).
 * @param {string} text
 */
function appendSystemMessage(text) {
  const row = document.createElement("div");
  row.className = "system-msg";
  const span = document.createElement("span");
  span.textContent = text;
  row.appendChild(span);

  removeWelcome();
  dom.messages.appendChild(row);
  scrollToBottom();
}

function clearMessages() {
  dom.messages.innerHTML = `
    <div class="welcome-msg">
      <span>👋</span>
      <p>Welcome! Say something to start the conversation.</p>
    </div>`;
}

function removeWelcome() {
  const welcome = dom.messages.querySelector(".welcome-msg");
  if (welcome) welcome.remove();
}

function scrollToBottom() {
  dom.messages.scrollTop = dom.messages.scrollHeight;
}

function setActiveRoomBtn(room) {
  document.querySelectorAll(".room-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.room === room);
  });
}

function updateHeader(room) {
  dom.headerRoomName.textContent = room;
  dom.headerRoomIcon.textContent = ROOM_ICONS[room] || "💬";
}

function setConnectionStatus(connected) {
  if (connected) {
    dom.connectionDot.className = "dot green";
    dom.connectionLabel.textContent = "Live";
    dom.headerStatus.textContent = "Connected";
  } else {
    dom.connectionDot.className = "dot red";
    dom.connectionLabel.textContent = "Offline";
    dom.headerStatus.textContent = "Disconnected";
  }
}

function updateBadge(room) {
  const badge = $(`badge-${room}`);
  if (!badge) return;
  const count = state.unread[room];
  if (count > 0) {
    badge.textContent = count > 9 ? "9+" : count;
    badge.classList.add("visible");
  } else {
    badge.textContent = "";
    badge.classList.remove("visible");
  }
}

/**
 * Sanitise user-supplied text to prevent XSS.
 */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}
