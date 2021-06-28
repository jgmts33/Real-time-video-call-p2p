/*
http://patorjk.com/software/taag/#p=display&f=ANSI%20Regular&t=Server

███████ ███████ ██████  ██    ██ ███████ ██████  
██      ██      ██   ██ ██    ██ ██      ██   ██ 
███████ █████   ██████  ██    ██ █████   ██████  
     ██ ██      ██   ██  ██  ██  ██      ██   ██ 
███████ ███████ ██   ██   ████   ███████ ██   ██                                           

dependencies: {
  compression : https://www.npmjs.com/package/compression
  dotenv      : https://www.npmjs.com/package/dotenv
  express     : https://www.npmjs.com/package/express
  ngrok       : https://www.npmjs.com/package/ngrok
  socket.io   : https://www.npmjs.com/package/socket.io
}

Mirotalk Signaling Server
Copyright (C) 2021 Miroslav Pejic <miroslav.pejic.85@gmail.com>

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

*/

"use strict"; // https://www.w3schools.com/js/js_strict.asp

require("dotenv").config();

const compression = require("compression");
const express = require("express");
const path = require("path");
const app = express();
app.use(compression()); // Compress all HTTP responses GZip
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server().listen(server);
const ngrok = require("ngrok");

let API_KEY_SECRET = process.env.API_KEY_SECRET || "mirotalk_default_secret";
let PORT = process.env.PORT || 3000; // signalingServerPort
let localHost = "http://localhost:" + PORT; // http
let channels = {}; // collect channels
let sockets = {}; // collect sockets
let peers = {}; // collect peers info grp by channels

let ngrokEnabled = process.env.NGROK_ENABLED;
let ngrokAuthToken = process.env.NGROK_AUTH_TOKEN;
let turnEnabled = process.env.TURN_ENABLED;
let turnUrls = process.env.TURN_URLS;
let turnUsername = process.env.TURN_USERNAME;
let turnCredential = process.env.TURN_PASSWORD;

// Use all static files from the www folder
app.use(express.static(path.join(__dirname, "www")));

// Api parse body data as json
app.use(express.json());

// Remove trailing slashes in url handle bad requests
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    logme("Request Error", {
      header: req.headers,
      body: req.body,
      error: err.message,
    });
    return res.status(400).send({ status: 404, message: err.message }); // Bad request
  }
  if (req.path.substr(-1) === "/" && req.path.length > 1) {
    let query = req.url.slice(req.path.length);
    res.redirect(301, req.path.slice(0, -1) + query);
  } else {
    next();
  }
});

/*
app.get(["/"], (req, res) => {
  res.sendFile(path.join(__dirname, "www/client.html"))
}); */

// all start from here
app.get(["/"], (req, res) => {
  res.sendFile(path.join(__dirname, "www/landing.html"));
});

// set new room name and join
app.get(["/newcall"], (req, res) => {
  res.sendFile(path.join(__dirname, "www/newcall.html"));
});

// if not allow video/audio
app.get(["/permission"], (req, res) => {
  res.sendFile(path.join(__dirname, "www/permission.html"));
});

// privacy policy
app.get(["/privacy"], (req, res) => {
  res.sendFile(path.join(__dirname, "www/privacy.html"));
});

// no room name specified to join
app.get("/join/", (req, res) => {
  res.redirect("/");
});

// join to room
app.get("/join/*", (req, res) => {
  if (Object.keys(req.query).length > 0) {
    logme("redirect:" + req.url + " to " + url.parse(req.url).pathname);
    res.redirect(url.parse(req.url).pathname);
  } else {
    res.sendFile(path.join(__dirname, "www/client.html"));
  }
});

/**
  MIROTALK API v1
  The response will give you a entrypoint / Room URL for your meeting.
*/
app.post(["/api/v1/meeting"], (req, res) => {
  // check if user was authorized for the api call
  let authorization = req.headers.authorization;
  if (authorization != API_KEY_SECRET) {
    logme("Mirotalk get meeting - Unauthorized", {
      header: req.headers,
      body: req.body,
    });
    return res.status(403).json({ error: "Unauthorized!" });
  }
  // setup mirotalk meeting URL
  let host = req.headers.host;
  let meetingURL = getMeetingURL(host) + "/join/" + makeId(15);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ meeting: meetingURL }));

  // logme the output if all done
  logme("Mirotalk get meeting - Authorized", {
    header: req.headers,
    body: req.body,
    meeting: meetingURL,
  });
});

/**
 * Get get Meeting Room URL
 * @param {*} host string
 * @returns meeting Room URL
 */
function getMeetingURL(host) {
  return "http" + (host.includes("localhost") ? "" : "s") + "://" + host;
}

/**
 * Generate random Id
 * @param {*} length int
 * @returns random id
 */
function makeId(length) {
  let result = "";
  let characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}
// end of MIROTALK API v1

/**
 * You should probably use a different stun-turn server
 * doing commercial stuff, also see:
 *
 * https://gist.github.com/zziuni/3741933
 * https://www.twilio.com/docs/stun-turn
 * https://github.com/coturn/coturn
 *
 * Check the functionality of STUN/TURN servers:
 * https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
 */
let iceServers = [{ urls: "stun:stun.l.google.com:19302" }];

if (turnEnabled == "true") {
  iceServers.push({
    urls: turnUrls,
    username: turnUsername,
    credential: turnCredential,
  });
}

/**
 * Expose server to external with https tunnel using ngrok
 * https://ngrok.com
 */
async function ngrokStart() {
  try {
    await ngrok.authtoken(ngrokAuthToken);
    await ngrok.connect(PORT);
    let api = ngrok.getApi();
    let data = await api.listTunnels();
    let pu0 = data.tunnels[0].public_url;
    let pu1 = data.tunnels[1].public_url;
    let tunnelHttps = pu0.startsWith("https") ? pu0 : pu1;
    // server settings
    logme("settings", {
      http: localHost,
      https: tunnelHttps,
      api_key_secret: API_KEY_SECRET,
      iceServers: iceServers,
      ngrok: {
        ngrok_enabled: ngrokEnabled,
        ngrok_token: ngrokAuthToken,
      },
    });
  } catch (err) {
    console.error("[Error] ngrokStart", err);
  }
}

/**
 * Start Local Server with ngrok https tunnel (optional)
 */
server.listen(PORT, null, () => {
  logme(
    `%c

	███████╗██╗ ██████╗ ███╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗ 
	██╔════╝██║██╔════╝ ████╗  ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
	███████╗██║██║  ███╗██╔██╗ ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
	╚════██║██║██║   ██║██║╚██╗██║╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
	███████║██║╚██████╔╝██║ ╚████║      ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
	╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝ started...

	`,
    "font-family:monospace"
  );

  // https tunnel
  if (ngrokEnabled == "true") {
    ngrokStart();
  } else {
    // server settings
    logme("settings", {
      http: localHost,
      api_key_secret: API_KEY_SECRET,
      iceServers: iceServers,
    });
  }
});

/**
 * Users will connect to the signaling server, after which they'll issue a "join"
 * to join a particular channel. The signaling server keeps track of all sockets
 * who are in a channel, and on join will send out 'addPeer' events to each pair
 * of users in a channel. When clients receive the 'addPeer' even they'll begin
 * setting up an RTCPeerConnection with one another. During this process they'll
 * need to relay ICECandidate information to one another, as well as SessionDescription
 * information. After all of that happens, they'll finally be able to complete
 * the peer connection and will be in streaming audio/video between eachother.
 * On peer connected
 */
io.sockets.on("connect", (socket) => {
  logme("[" + socket.id + "] --> connection accepted");

  socket.channels = {};
  sockets[socket.id] = socket;

  /**
   * On peer diconnected
   */
  socket.on("disconnect", () => {
    for (let channel in socket.channels) {
      removePeerFrom(channel);
    }
    logme("[" + socket.id + "] <--> disconnected");
    delete sockets[socket.id];
  });

  /**
   * On peer join
   */
  socket.on("join", (config) => {
    logme("[" + socket.id + "] --> join ", config);

    let channel = config.channel;
    let peer_name = config.peerName;
    let peer_video = config.peerVideo;
    let peer_audio = config.peerAudio;
    let peer_hand = config.peerHand;

    if (channel in socket.channels) {
      logme("[" + socket.id + "] [Warning] already joined", channel);
      return;
    }
    // no channel aka room in channels init
    if (!(channel in channels)) {
      channels[channel] = {};
    }

    // no channel aka room in peers init
    if (!(channel in peers)) {
      peers[channel] = {};
    }

    // collect peers info grp by channels
    peers[channel][socket.id] = {
      peer_name: peer_name,
      peer_video: peer_video,
      peer_audio: peer_audio,
      peer_hand: peer_hand,
    };
    logme("connected peers grp by roomId", peers);

    for (let id in channels[channel]) {
      // offer false
      channels[channel][id].emit("addPeer", {
        peer_id: socket.id,
        peers: peers[channel],
        should_create_offer: false,
        iceServers: iceServers,
      });
      // offer true
      socket.emit("addPeer", {
        peer_id: id,
        peers: peers[channel],
        should_create_offer: true,
        iceServers: iceServers,
      });
      logme("[" + socket.id + "] emit addPeer [" + id + "]");
    }

    channels[channel][socket.id] = socket;
    socket.channels[channel] = channel;
  });

  /**
   * Remove peers from channel aka room
   * @param {*} channel
   */
  async function removePeerFrom(channel) {
    if (!(channel in socket.channels)) {
      logme("[" + socket.id + "] [Warning] not in ", channel);
      return;
    }

    delete socket.channels[channel];
    delete channels[channel][socket.id];
    delete peers[channel][socket.id];

    // if not channel aka room in peers remove it
    if (Object.keys(peers[channel]).length === 0) {
      delete peers[channel];
    }

    for (let id in channels[channel]) {
      await channels[channel][id].emit("removePeer", { peer_id: socket.id });
      await socket.emit("removePeer", { peer_id: id });
      logme("[" + socket.id + "] emit removePeer [" + id + "]");
    }
  }

  /**
   * Relay ICE to peers
   */
  socket.on("relayICE", (config) => {
    let peer_id = config.peer_id;
    let ice_candidate = config.ice_candidate;
    /*
    logme(
      "[" + socket.id + "] relay ICE-candidate to [" + peer_id + "] ",
      { address: config.ice_candidate.address }
    );
    */
    if (peer_id in sockets) {
      sockets[peer_id].emit("iceCandidate", {
        peer_id: socket.id,
        ice_candidate: ice_candidate,
      });
    }
  });

  /**
   * Relay SDP to peers
   */
  socket.on("relaySDP", (config) => {
    let peer_id = config.peer_id;
    let session_description = config.session_description;

    logme(
      "[" + socket.id + "] relay SessionDescription to [" + peer_id + "] ",
      { type: session_description.type }
    );

    if (peer_id in sockets) {
      sockets[peer_id].emit("sessionDescription", {
        peer_id: socket.id,
        session_description: session_description,
      });
    }
  });

  /**
   * Relay NAME to peers
   */
  socket.on("peerName", (config) => {
    let peerConnections = config.peerConnections;
    let room_id = config.room_id;
    let peer_name_old = config.peer_name_old;
    let peer_name_new = config.peer_name_new;
    let peer_id_to_update = null;

    // update peers new name in the specified room
    for (let peer_id in peers[room_id]) {
      if (peers[room_id][peer_id]["peer_name"] == peer_name_old) {
        peers[room_id][peer_id]["peer_name"] = peer_name_new;
        peer_id_to_update = peer_id;
        /*
        logme("[" + socket.id + "] change peer name", {
          room_id: room_id,
          peer_id: peer_id,
          peer_name_old: peer_name_old,
          peer_name_new: peer_name_new,
        });
        */
      }
    }

    // refresh if found
    if (peer_id_to_update && Object.keys(peerConnections).length != 0) {
      logme("[" + socket.id + "] emit peerName to [room_id: " + room_id + "]", {
        peer_id: peer_id_to_update,
        peer_name: peer_name_new,
      });
      for (let peer_id in peerConnections) {
        if (sockets[peer_id]) {
          sockets[peer_id].emit("peerName", {
            peer_id: peer_id_to_update,
            peer_name: peer_name_new,
          });
        }
      }
    }
  });

  /**
   * Relay Audio Video Hand ... Status to peers
   */
  socket.on("peerStatus", (config) => {
    let peerConnections = config.peerConnections;
    let room_id = config.room_id;
    let peer_name = config.peer_name;
    let element = config.element;
    let status = config.status;

    // update peers video-audio status in the specified room
    for (let peer_id in peers[room_id]) {
      if (peers[room_id][peer_id]["peer_name"] == peer_name) {
        switch (element) {
          case "video":
            peers[room_id][peer_id]["peer_video"] = status;
            break;
          case "audio":
            peers[room_id][peer_id]["peer_audio"] = status;
            break;
          case "hand":
            peers[room_id][peer_id]["peer_hand"] = status;
            break;
        }
        /*
        logme("[" + socket.id + "] change " + element + " status", {
          room_id: room_id,
          peer_name: peer_name,
          element: element,
          status: status,
        }); 
        */
      }
    }

    // socket.id aka peer that send this status
    if (Object.keys(peerConnections).length != 0) {
      logme(
        "[" + socket.id + "] emit peerStatus to [room_id: " + room_id + "]",
        {
          peer_id: socket.id,
          element: element,
          status: status,
        }
      );
      for (let peer_id in peerConnections) {
        if (sockets[peer_id]) {
          sockets[peer_id].emit("peerStatus", {
            peer_id: socket.id,
            peer_name: peer_name,
            element: element,
            status: status,
          });
        }
      }
    }
  });

  /**
   * Relay actions to peers in the same room
   */
  socket.on("peerAction", (config) => {
    let peerConnections = config.peerConnections;
    let room_id = config.room_id;
    let peer_name = config.peer_name;
    let peer_action = config.peer_action;

    // socket.id aka peer that send this status
    if (Object.keys(peerConnections).length != 0) {
      logme(
        "[" + socket.id + "] emit peerAction to [room_id: " + room_id + "]",
        {
          peer_id: socket.id,
          peer_name: peer_name,
          peer_action: peer_action,
        }
      );
      for (let peer_id in peerConnections) {
        if (sockets[peer_id]) {
          sockets[peer_id].emit("peerAction", {
            peer_name: peer_name,
            peer_action: peer_action,
          });
        }
      }
    }
  });

  /**
   * Relay Kick out peer from room
   */
  socket.on("kickOut", (config) => {
    let room_id = config.room_id;
    let peer_id = config.peer_id;
    let peer_name = config.peer_name;

    logme(
      "[" +
        socket.id +
        "] kick out peer [" +
        peer_id +
        "] from room_id [" +
        room_id +
        "]"
    );

    if (peer_id in sockets) {
      sockets[peer_id].emit("kickOut", {
        peer_name: peer_name,
      });
    }
  });

  /**
   * Relay File info
   */
  socket.on("fileInfo", (config) => {
    let peerConnections = config.peerConnections;
    let room_id = config.room_id;
    let peer_name = config.peer_name;
    let file = config.file;

    logme(
      "[" +
        socket.id +
        "] Peer [" +
        peer_name +
        "] send file to room_id [" +
        room_id +
        "]",
      {
        fileName: file.fileName,
        fileSize: bytesToSize(file.fileSize),
        fileType: file.fileType,
      }
    );

    function bytesToSize(bytes) {
      let sizes = ["Bytes", "KB", "MB", "GB", "TB"];
      if (bytes == 0) return "0 Byte";
      let i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
      return Math.round(bytes / Math.pow(1024, i), 2) + " " + sizes[i];
    }

    if (Object.keys(peerConnections).length != 0) {
      for (let peer_id in peerConnections) {
        if (sockets[peer_id]) {
          sockets[peer_id].emit("fileInfo", file);
        }
      }
    }
  });

  /**
   * Whiteboard actions for all user in the same room
   */
  socket.on("wb", (config) => {
    let peerConnections = config.peerConnections;
    delete config.peerConnections;
    if (Object.keys(peerConnections).length != 0) {
      // logme("[" + socket.id + "] whiteboard config", config);
      for (let peer_id in peerConnections) {
        if (sockets[peer_id]) {
          sockets[peer_id].emit("wb", config);
        }
      }
    }
  });
}); // end [sockets.on-connect]

/**
 * log with UTC data time
 * @param {*} msg message any
 * @param {*} op optional params
 */
function logme(msg, op = "") {
  let dataTime = new Date().toISOString().replace(/T/, " ").replace(/Z/, "");
  console.log("[" + dataTime + "] " + msg, op);
}
