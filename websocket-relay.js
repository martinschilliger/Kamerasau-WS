// Use the websocket-relay to serve a raw MPEG-TS over WebSockets. You can use
// ffmpeg to feed the relay. ffmpeg -> websocket-relay -> browser
// Example:
// node websocket-relay yoursecret 8081 8082
// ffmpeg -i <some input> -f mpegts http://localhost:8081/yoursecret

const fs = require("fs");
const http = require("http");
const WebSocket = require("ws");

if (process.argv.length < 3) {
  console.log(
    "Usage: \n" +
      "node websocket-relay.js <secret> [<stream-port> <websocket-port> <api-port>]"
  );
  process.exit();
}

const STREAM_SECRET = process.argv[2],
  STREAM_PORT = process.argv[3] || 8081,
  WEBSOCKET_PORT = process.argv[4] || 8082,
  RECORD_STREAM = false,
  API_PORT = process.argv[5] || 8083;
let streamActive = false;

// Websocket Server
let socketServer = new WebSocket.Server({
  port: WEBSOCKET_PORT,
  perMessageDeflate: false
});
socketServer.connectionCount = 0;
function noop() {}
function heartbeat() {
  this.isAlive = true;
}
socketServer.on("connection", function (socket) {
  socketServer.connectionCount++;
  socket.isAlive = true;
  socket.on("pong", heartbeat);

  socket.on("close", function () {
    socketServer.connectionCount--;
    socketServer.emit("disconnection", socket);
  });
});

const interval = setInterval(function ping() {
  socketServer.clients.forEach(function each(socket) {
    if (socket.isAlive === false) {
      return socket.close();
    }
    socket.isAlive = false;
    socket.ping(noop);
  });
}, 5000);
socketServer.on("close", function close() {
  clearInterval(interval);
});

socketServer.broadcast = function (data) {
  socketServer.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
};

// HTTP Server to accept incoming MPEG-TS Stream from ffmpeg
http
  .createServer(function (request, response) {
    var params = request.url.substr(1).split("/");

    if (params[0] !== STREAM_SECRET) {
      console.log(
        "Failed Stream Connection: " +
          request.socket.remoteAddress +
          ":" +
          request.socket.remotePort +
          " - wrong secret."
      );
      response.end();
    }

    console.log(
      "Stream connected: " +
        request.socket.remoteAddress +
        ":" +
        request.socket.remotePort
    );
    request.on("data", function (data) {
      streamActive = true;
      socketServer.broadcast(data);
      if (request.socket.recording) {
        request.socket.recording.write(data);
      }
    });

    // TODO: Funktioniert nicht bei abruptem Ende, Stromunterbruch oder so…
    request.on("close", function () {
      streamActive = false;
      console.log(
        `Stream closed: ${request.socket.remoteAddress}:${request.socket.remotePort}`
      );
      if (request.socket.recording) {
        request.socket.recording.close();
      }
    });
    request.on("end", function () {
      streamActive = false;
      console.log(
        `Stream ended: ${request.socket.remoteAddress}:${request.socket.remotePort}`
      );
      if (request.socket.recording) {
        request.socket.recording.close();
      }
    });

    // Record the stream to a local file?
    if (RECORD_STREAM) {
      let path = "recordings/port-" + STREAM_PORT + "/" + Date.now() + ".ts";
      request.socket.recording = fs.createWriteStream(path);
    }
  })
  .listen(STREAM_PORT);

// api server
http
  .createServer(function (request, response) {
    var data = {
      number: Number(String(API_PORT).slice(-2)),
      stream_active: streamActive,
      client_connections: socketServer.connectionCount
    };
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(data));
  })
  .listen(API_PORT);

console.log(
  "Listening for incomming MPEG-TS Stream on http://127.0.0.1:" +
    STREAM_PORT +
    "/<secret>"
);
console.log(
  "Awaiting WebSocket connections on ws://127.0.0.1:" + WEBSOCKET_PORT + "/"
);
console.log("Serving details about service on http://127.0.0.1:" + API_PORT);
