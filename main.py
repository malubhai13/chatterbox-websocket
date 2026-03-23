"""
Chatterbox - Real-Time WebSocket Chat Application
Backend: FastAPI + WebSockets
Author: Chatterbox Team
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import json
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Chatterbox")

# ─────────────────────────────────────────────
# Connection Manager
# Maintains all active connections, usernames,
# and room assignments.
# ─────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        # Maps websocket → username
        self.usernames: dict[WebSocket, str] = {}
        # Maps websocket → room name
        self.rooms: dict[WebSocket, str] = {}

    async def connect(self, websocket: WebSocket, username: str, room: str):
        """Accept a new WebSocket connection and register the user."""
        await websocket.accept()
        self.usernames[websocket] = username
        self.rooms[websocket] = room
        logger.info(f"[CONNECT] {username} joined room '{room}'")

    def disconnect(self, websocket: WebSocket):
        """Remove a disconnected WebSocket from all mappings."""
        username = self.usernames.pop(websocket, "Unknown")
        room = self.rooms.pop(websocket, None)
        logger.info(f"[DISCONNECT] {username} left room '{room}'")
        return username, room

    def get_room_members(self, room: str) -> list[WebSocket]:
        """Return all WebSocket connections currently in a given room."""
        return [ws for ws, r in self.rooms.items() if r == room]

    def get_username(self, websocket: WebSocket) -> str:
        return self.usernames.get(websocket, "Unknown")

    def get_room(self, websocket: WebSocket) -> str:
        return self.rooms.get(websocket, "")

    def update_room(self, websocket: WebSocket, new_room: str):
        """Switch a user to a different room."""
        self.rooms[websocket] = new_room

    async def broadcast(self, room: str, data: dict, exclude: WebSocket = None):
        """
        Broadcast a JSON message to all users in a room.
        Optionally exclude one sender (e.g. for system confirmations).
        """
        members = self.get_room_members(room)
        disconnected = []

        for ws in members:
            if ws == exclude:
                continue
            try:
                await ws.send_json(data)
            except Exception:
                disconnected.append(ws)

        # Clean up any sockets that failed mid-broadcast
        for ws in disconnected:
            self.disconnect(ws)

    async def broadcast_to_all_in_room(self, room: str, data: dict):
        """Broadcast to every member of the room including sender."""
        await self.broadcast(room, data, exclude=None)


manager = ConnectionManager()


# ─────────────────────────────────────────────
# Static Files + Root Route
# ─────────────────────────────────────────────
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return FileResponse("static/index.html")


# ─────────────────────────────────────────────
# WebSocket Endpoint
# ─────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Main WebSocket handler.

    Expected JSON event types from client:
      - join        { type, username, room }
      - chat        { type, message }
      - typing      { type }
      - stop_typing { type }
      - switch_room { type, room }

    Messages sent to clients:
      - system      { type, message }
      - chat        { type, username, message, timestamp }
      - typing      { type, username }
      - stop_typing { type, username }
    """
    # Accept raw socket first; we'll officially register after receiving 'join'
    await websocket.accept()

    username = None
    current_room = None
    joined = False

    try:
        async for raw in websocket.iter_text():
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "system", "message": "Invalid JSON received."})
                continue

            event = data.get("type")

            # ── JOIN ──────────────────────────────────────────
            if event == "join":
                username = data.get("username", "Anonymous").strip() or "Anonymous"
                room = data.get("room", "General").strip() or "General"

                # Register in manager (without re-accepting)
                manager.usernames[websocket] = username
                manager.rooms[websocket] = room
                current_room = room
                joined = True

                logger.info(f"[JOIN] {username} → {room}")

                # Notify everyone in the room
                await manager.broadcast_to_all_in_room(room, {
                    "type": "system",
                    "message": f"{username} joined {room} 👋"
                })

            # ── CHAT ─────────────────────────────────────────
            elif event == "chat" and joined:
                message = data.get("message", "").strip()
                if not message:
                    continue  # Ignore empty messages

                from datetime import datetime
                timestamp = datetime.now().strftime("%H:%M")

                await manager.broadcast_to_all_in_room(current_room, {
                    "type": "chat",
                    "username": username,
                    "message": message,
                    "timestamp": timestamp
                })

            # ── TYPING ───────────────────────────────────────
            elif event == "typing" and joined:
                # Broadcast typing indicator to others in the room
                await manager.broadcast(current_room, {
                    "type": "typing",
                    "username": username
                }, exclude=websocket)

            # ── STOP TYPING ──────────────────────────────────
            elif event == "stop_typing" and joined:
                await manager.broadcast(current_room, {
                    "type": "stop_typing",
                    "username": username
                }, exclude=websocket)

            # ── SWITCH ROOM ──────────────────────────────────
            elif event == "switch_room" and joined:
                new_room = data.get("room", "General").strip()
                old_room = current_room

                if new_room == old_room:
                    continue

                # Notify old room of departure
                await manager.broadcast(old_room, {
                    "type": "system",
                    "message": f"{username} left {old_room} ❌"
                }, exclude=websocket)

                # Move user to new room
                manager.update_room(websocket, new_room)
                current_room = new_room

                # Notify new room of arrival
                await manager.broadcast_to_all_in_room(new_room, {
                    "type": "system",
                    "message": f"{username} joined {new_room} 👋"
                })

                logger.info(f"[SWITCH] {username}: {old_room} → {new_room}")

    except WebSocketDisconnect:
        if joined and username and current_room:
            manager.disconnect(websocket)
            await manager.broadcast(current_room, {
                "type": "system",
                "message": f"{username} left {current_room} ❌"
            }, exclude=websocket)
            logger.info(f"[DISCONNECT] {username} left {current_room}")
    except Exception as e:
        logger.error(f"[ERROR] Unexpected error: {e}")
        try:
            manager.disconnect(websocket)
        except Exception:
            pass
