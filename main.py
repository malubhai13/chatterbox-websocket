from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from connection_manager import ConnectionManager
import uvicorn

app = FastAPI(title="Chatterbox WebSocket Server")

manager = ConnectionManager()


@app.get("/")
async def root():
    return {"message": " WebSocket Server is Running"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    await manager.broadcast("A new user joined the chat!")

    try:
        while True:
            data = await websocket.receive_text()
            await manager.broadcast(f" {data}")

    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast(" A user left the chat.")


if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)