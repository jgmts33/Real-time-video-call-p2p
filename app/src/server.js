/*
http://patorjk.com/software/taag/#p=display&f=ANSI%20Regular&t=Server

███████ ███████ ██████  ██    ██ ███████ ██████  
██      ██      ██   ██ ██    ██ ██      ██   ██ 
███████ █████   ██████  ██    ██ █████   ██████  
     ██ ██      ██   ██  ██  ██  ██      ██   ██ 
███████ ███████ ██   ██   ████   ███████ ██   ██                                           

dependencies: {
    compression : https://www.npmjs.com/package/compression
    cors        : https://www.npmjs.com/package/cors
    dotenv      : https://www.npmjs.com/package/dotenv
    express     : https://www.npmjs.com/package/express
    ngrok       : https://www.npmjs.com/package/ngrok
    socket.io   : https://www.npmjs.com/package/socket.io
    swagger     : https://www.npmjs.com/package/swagger-ui-express
    uuid        : https://www.npmjs.com/package/uuid
    yamljs      : https://www.npmjs.com/package/yamljs
}
*/

/**
 * MiroTalk P2P - Server component
 *
 * @link    https://mirotalk.up.railway.app or https://mirotalk.herokuapp.com
 * @license For open source use: AGPLv3
 *          For commercial use: https://github.com/miroslavpejic85/mirotalk#commercial-license-or-closed-source
 * @author  Miroslav Pejic - miroslav.pejic.85@gmail.com
 * @version 1.0.0
 *
 */

'use strict'; // https://www.w3schools.com/js/js_strict.asp

require('dotenv').config();

const { Server } = require('socket.io');
const http = require('http');
const https = require('https');
const compression = require('compression');
const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

const Logger = require('./Logger');
const log = new Logger('server');

const isHttps = false; // must be the same on client.js
const port = process.env.PORT || 3000; // must be the same to client.js signalingServerPort

let io, server, host;

if (isHttps) {
    const fs = require('fs');
    const options = {
        key: fs.readFileSync(path.join(__dirname, '../ssl/key.pem'), 'utf-8'),
        cert: fs.readFileSync(path.join(__dirname, '../ssl/cert.pem'), 'utf-8'),
    };
    server = https.createServer(options, app);
    host = 'https://' + 'localhost' + ':' + port;
} else {
    server = http.createServer(app);
    host = 'http://' + 'localhost' + ':' + port;
}

/*  
    Set maxHttpBufferSize from 1e6 (1MB) to 1e7 (10MB)
*/
io = new Server({
    maxHttpBufferSize: 1e7,
}).listen(server);

// console.log(io);

// Swagger config
const yamlJS = require('yamljs');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = yamlJS.load(path.join(__dirname + '/../api/swagger.yaml'));

// Api config
const { v4: uuidV4 } = require('uuid');
const apiBasePath = '/api/v1'; // api endpoint path
const api_docs = host + apiBasePath + '/docs'; // api docs
const api_key_secret = process.env.API_KEY_SECRET || 'mirotalk_default_secret';

// Ngrok config
const ngrok = require('ngrok');
const ngrokEnabled = process.env.NGROK_ENABLED;
const ngrokAuthToken = process.env.NGROK_AUTH_TOKEN;

// Turn config
const turnEnabled = process.env.TURN_ENABLED;
const turnUrls = process.env.TURN_URLS;
const turnUsername = process.env.TURN_USERNAME;
const turnCredential = process.env.TURN_PASSWORD;

// directory
const dir = {
    public: path.join(__dirname, '../../', 'public'),
};
// html views
const view = {
    about: path.join(__dirname, '../../', 'public/view/about.html'),
    client: path.join(__dirname, '../../', 'public/view/client.html'),
    landing: path.join(__dirname, '../../', 'public/view/landing.html'),
    newCall: path.join(__dirname, '../../', 'public/view/newcall.html'),
    notFound: path.join(__dirname, '../../', 'public/view/404.html'),
    permission: path.join(__dirname, '../../', 'public/view/permission.html'),
    privacy: path.join(__dirname, '../../', 'public/view/privacy.html'),
};

let channels = {}; // collect channels
let sockets = {}; // collect sockets
let peers = {}; // collect peers info grp by channels

app.use(cors()); // Enable All CORS Requests for all origins
app.use(compression()); // Compress all HTTP responses using GZip
app.use(express.json()); // Api parse body data as json
app.use(express.static(dir.public)); // Use all static files from the public folder

// Remove trailing slashes in url handle bad requests
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        log.debug('Request Error', {
            header: req.headers,
            body: req.body,
            error: err.message,
        });
        return res.status(400).send({ status: 404, message: err.message }); // Bad request
    }
    if (req.path.substr(-1) === '/' && req.path.length > 1) {
        let query = req.url.slice(req.path.length);
        res.redirect(301, req.path.slice(0, -1) + query);
    } else {
        next();
    }
});

// all start from here
app.get(['/'], (req, res) => {
    res.sendFile(view.landing);
});

// mirotalk about
app.get(['/about'], (req, res) => {
    res.sendFile(view.about);
});

// set new room name and join
app.get(['/newcall'], (req, res) => {
    res.sendFile(view.newCall);
});

// if not allow video/audio
app.get(['/permission'], (req, res) => {
    res.sendFile(view.permission);
});

// privacy policy
app.get(['/privacy'], (req, res) => {
    res.sendFile(view.privacy);
});

// no room name specified to join
app.get('/join/', (req, res) => {
    if (Object.keys(req.query).length > 0) {
        log.debug('Request Query', req.query);
        /* 
            http://localhost:3000/join?room=test&name=mirotalk&audio=1&video=1&notify=1
            https://mirotalk.up.railway.app/join?room=test&name=mirotalk&audio=1&video=1&notify=1
            https://mirotalk.herokuapp.com/join?room=test&name=mirotalk&audio=1&video=1&notify=1
        */
        let roomName = req.query.room;
        let peerName = req.query.name;
        let peerAudio = req.query.audio;
        let peerVideo = req.query.video;
        let notify = req.query.notify;
        // all the params are mandatory for the direct room join
        if (roomName && peerName && peerAudio && peerVideo && notify) {
            return res.sendFile(view.client);
        }
    }
    res.redirect('/');
});

// Join Room *
app.get('/join/*', (req, res) => {
    res.sendFile(view.client);
});

/**
    MiroTalk API v1
    For api docs we use: https://swagger.io/
*/

// api docs
app.use(apiBasePath + '/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// request meeting room endpoint
app.post([apiBasePath + '/meeting'], (req, res) => {
    // check if user was authorized for the api call
    let authorization = req.headers.authorization;
    if (authorization != api_key_secret) {
        log.debug('MiroTalk get meeting - Unauthorized', {
            header: req.headers,
            body: req.body,
        });
        return res.status(403).json({ error: 'Unauthorized!' });
    }
    // setup meeting URL
    let host = req.headers.host;
    let meetingURL = getMeetingURL(host);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ meeting: meetingURL }));

    // log.debug the output if all done
    log.debug('MiroTalk get meeting - Authorized', {
        header: req.headers,
        body: req.body,
        meeting: meetingURL,
    });
});

/**
 * Request meeting room endpoint
 * @returns  entrypoint / Room URL for your meeting.
 */
function getMeetingURL(host) {
    return 'http' + (host.includes('localhost') ? '' : 's') + '://' + host + '/join/' + uuidV4();
}

// end of MiroTalk API v1

// not match any of page before, so 404 not found
app.get('*', function (req, res) {
    res.sendFile(view.notFound);
});

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
const iceServers = [];

if (turnEnabled == 'true') {
    iceServers.push(
        {
            urls: 'stun:stun.l.google.com:19302',
        },
        {
            urls: turnUrls,
            username: turnUsername,
            credential: turnCredential,
        },
    );
} else {
    // Thanks to https://www.metered.ca/tools/openrelay/
    iceServers.push(
        {
            urls: 'stun:openrelay.metered.ca:80',
        },
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject',
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject',
        },
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject',
        },
    );
}

/**
 * Expose server to external with https tunnel using ngrok
 * https://ngrok.com
 */
async function ngrokStart() {
    try {
        await ngrok.authtoken(ngrokAuthToken);
        await ngrok.connect(port);
        let api = ngrok.getApi();
        let data = await api.listTunnels();
        let pu0 = data.tunnels[0].public_url;
        let pu1 = data.tunnels[1].public_url;
        let tunnelHttps = pu0.startsWith('https') ? pu0 : pu1;
        // server settings
        log.debug('settings', {
            iceServers: iceServers,
            ngrok: {
                ngrok_enabled: ngrokEnabled,
                ngrok_token: ngrokAuthToken,
            },
            server: host,
            server_tunnel: tunnelHttps,
            api_docs: api_docs,
            api_key_secret: api_key_secret,
        });
    } catch (err) {
        console.error('[Error] ngrokStart', err);
        process.exit(1);
    }
}

/**
 * Start Local Server with ngrok https tunnel (optional)
 */
server.listen(port, null, () => {
    log.debug(
        `%c

	███████╗██╗ ██████╗ ███╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗ 
	██╔════╝██║██╔════╝ ████╗  ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
	███████╗██║██║  ███╗██╔██╗ ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
	╚════██║██║██║   ██║██║╚██╗██║╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
	███████║██║╚██████╔╝██║ ╚████║      ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
	╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝ started...

	`,
        'font-family:monospace',
    );

    // https tunnel
    if (ngrokEnabled == 'true' && isHttps === false) {
        ngrokStart();
    } else {
        // server settings
        log.debug('settings', {
            iceServers: iceServers,
            server: host,
            api_docs: api_docs,
            api_key_secret: api_key_secret,
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
io.sockets.on('connect', (socket) => {
    log.debug('[' + socket.id + '] connection accepted');

    socket.channels = {};
    sockets[socket.id] = socket;

    /**
     * On peer diconnected
     */
    socket.on('disconnect', (reason) => {
        for (let channel in socket.channels) {
            removePeerFrom(channel);
        }
        log.debug('[' + socket.id + '] disconnected', { reason: reason });
        delete sockets[socket.id];
    });

    /**
     * On peer join
     */
    socket.on('join', (config) => {
        log.debug('[' + socket.id + '] join ', config);

        let channel = config.channel;
        let peer_name = config.peer_name;
        let peer_video = config.peer_video;
        let peer_audio = config.peer_audio;
        let peer_hand = config.peer_hand;
        let peer_rec = config.peer_rec;

        if (channel in socket.channels) {
            log.debug('[' + socket.id + '] [Warning] already joined', channel);
            return;
        }
        // no channel aka room in channels init
        if (!(channel in channels)) channels[channel] = {};

        // no channel aka room in peers init
        if (!(channel in peers)) peers[channel] = {};

        // room locked by the participants can't join
        if (peers[channel]['Locked'] === true) {
            log.debug('[' + socket.id + '] [Warning] Room Is Locked', channel);
            socket.emit('roomIsLocked');
            return;
        }

        // collect peers info grp by channels
        peers[channel][socket.id] = {
            peer_name: peer_name,
            peer_video: peer_video,
            peer_audio: peer_audio,
            peer_hand: peer_hand,
            peer_rec: peer_rec,
        };
        log.debug('connected peers grp by roomId', peers);

        addPeerTo(channel);

        channels[channel][socket.id] = socket;
        socket.channels[channel] = channel;
    });

    /**
     * Add peers to channel aka room
     * @param {*} channel
     */
    async function addPeerTo(channel) {
        for (let id in channels[channel]) {
            // offer false
            await channels[channel][id].emit('addPeer', {
                peer_id: socket.id,
                peers: peers[channel],
                should_create_offer: false,
                iceServers: iceServers,
            });
            // offer true
            socket.emit('addPeer', {
                peer_id: id,
                peers: peers[channel],
                should_create_offer: true,
                iceServers: iceServers,
            });
            log.debug('[' + socket.id + '] emit addPeer [' + id + ']');
        }
    }

    /**
     * Remove peers from channel aka room
     * @param {*} channel
     */
    async function removePeerFrom(channel) {
        if (!(channel in socket.channels)) {
            log.debug('[' + socket.id + '] [Warning] not in ', channel);
            return;
        }

        delete socket.channels[channel];
        delete channels[channel][socket.id];
        delete peers[channel][socket.id];

        switch (Object.keys(peers[channel]).length) {
            case 0:
                // last peer disconnected from the room without room status set, delete room data
                delete peers[channel];
                break;
            case 1:
                // last peer disconnected from the room having room status set, delete room data
                if ('Locked' in peers[channel]) delete peers[channel];
                break;
        }
        log.debug('connected peers grp by roomId', peers);

        for (let id in channels[channel]) {
            await channels[channel][id].emit('removePeer', { peer_id: socket.id });
            socket.emit('removePeer', { peer_id: id });
            log.debug('[' + socket.id + '] emit removePeer [' + id + ']');
        }
    }

    /**
     * Relay ICE to peers
     */
    socket.on('relayICE', (config) => {
        let peer_id = config.peer_id;
        let ice_candidate = config.ice_candidate;

        // log.debug('[' + socket.id + '] relay ICE-candidate to [' + peer_id + '] ', {
        //     address: config.ice_candidate,
        // });

        sendToPeer(peer_id, sockets, 'iceCandidate', {
            peer_id: socket.id,
            ice_candidate: ice_candidate,
        });
    });

    /**
     * Relay SDP to peers
     */
    socket.on('relaySDP', (config) => {
        let peer_id = config.peer_id;
        let session_description = config.session_description;

        log.debug('[' + socket.id + '] relay SessionDescription to [' + peer_id + '] ', {
            type: session_description.type,
        });

        sendToPeer(peer_id, sockets, 'sessionDescription', {
            peer_id: socket.id,
            session_description: session_description,
        });
    });

    /**
     * Refresh Room Status (Locked/Unlocked)
     */
    socket.on('roomStatus', (config) => {
        let room_id = config.room_id;
        let room_locked = config.room_locked;
        let peer_name = config.peer_name;

        peers[room_id]['Locked'] = room_locked;

        log.debug('[' + socket.id + '] emit roomStatus' + ' to [room_id: ' + room_id + ' locked: ' + room_locked + ']');

        sendToRoom(room_id, socket.id, 'roomStatus', {
            peer_name: peer_name,
            room_locked: room_locked,
        });
    });

    /**
     * Relay NAME to peers
     */
    socket.on('peerName', (config) => {
        let room_id = config.room_id;
        let peer_name_old = config.peer_name_old;
        let peer_name_new = config.peer_name_new;
        let peer_id_to_update = null;

        for (let peer_id in peers[room_id]) {
            if (peers[room_id][peer_id]['peer_name'] == peer_name_old) {
                peers[room_id][peer_id]['peer_name'] = peer_name_new;
                peer_id_to_update = peer_id;
            }
        }

        if (peer_id_to_update) {
            log.debug('[' + socket.id + '] emit peerName to [room_id: ' + room_id + ']', {
                peer_id: peer_id_to_update,
                peer_name: peer_name_new,
            });

            sendToRoom(room_id, socket.id, 'peerName', {
                peer_id: peer_id_to_update,
                peer_name: peer_name_new,
            });
        }
    });

    /**
     * Relay Audio Video Hand ... Status to peers
     */
    socket.on('peerStatus', (config) => {
        let room_id = config.room_id;
        let peer_name = config.peer_name;
        let element = config.element;
        let status = config.status;

        for (let peer_id in peers[room_id]) {
            if (peers[room_id][peer_id]['peer_name'] == peer_name) {
                switch (element) {
                    case 'video':
                        peers[room_id][peer_id]['peer_video'] = status;
                        break;
                    case 'audio':
                        peers[room_id][peer_id]['peer_audio'] = status;
                        break;
                    case 'hand':
                        peers[room_id][peer_id]['peer_hand'] = status;
                        break;
                    case 'rec':
                        peers[room_id][peer_id]['peer_rec'] = status;
                        break;
                }
            }
        }

        log.debug('[' + socket.id + '] emit peerStatus to [room_id: ' + room_id + ']', {
            peer_id: socket.id,
            element: element,
            status: status,
        });

        sendToRoom(room_id, socket.id, 'peerStatus', {
            peer_id: socket.id,
            peer_name: peer_name,
            element: element,
            status: status,
        });
    });

    /**
     * Relay actions to peers or specific peer in the same room
     */
    socket.on('peerAction', (config) => {
        let room_id = config.room_id;
        let peer_name = config.peer_name;
        let peer_action = config.peer_action;
        let peer_id = config.peer_id;

        if (peer_id) {
            log.debug('[' + socket.id + '] emit peerAction to [' + peer_id + '] from room_id [' + room_id + ']');

            sendToPeer(peer_id, sockets, 'peerAction', {
                peer_name: peer_name,
                peer_action: peer_action,
            });
        } else {
            log.debug('[' + socket.id + '] emit peerAction to [room_id: ' + room_id + ']', {
                peer_id: socket.id,
                peer_name: peer_name,
                peer_action: peer_action,
            });

            sendToRoom(room_id, socket.id, 'peerAction', {
                peer_name: peer_name,
                peer_action: peer_action,
            });
        }
    });

    /**
     * Relay Kick out peer from room
     */
    socket.on('kickOut', (config) => {
        let room_id = config.room_id;
        let peer_id = config.peer_id;
        let peer_name = config.peer_name;

        log.debug('[' + socket.id + '] kick out peer [' + peer_id + '] from room_id [' + room_id + ']');

        sendToPeer(peer_id, sockets, 'kickOut', {
            peer_name: peer_name,
        });
    });

    /**
     * Relay File info
     */
    socket.on('fileInfo', (config) => {
        let room_id = config.room_id;
        let peer_name = config.peer_name;
        let file = config.file;

        function bytesToSize(bytes) {
            let sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
            if (bytes == 0) return '0 Byte';
            let i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
            return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
        }

        file['peerName'] = peer_name;

        log.debug('[' + socket.id + '] Peer [' + peer_name + '] send file to room_id [' + room_id + ']', {
            peerName: file.peerName,
            fileName: file.fileName,
            fileSize: bytesToSize(file.fileSize),
            fileType: file.fileType,
        });

        sendToRoom(room_id, socket.id, 'fileInfo', file);
    });

    /**
     * Abort file sharing
     */
    socket.on('fileAbort', (config) => {
        let room_id = config.room_id;
        let peer_name = config.peer_name;

        log.debug('[' + socket.id + '] Peer [' + peer_name + '] send fileAbort to room_id [' + room_id + ']');
        sendToRoom(room_id, socket.id, 'fileAbort');
    });

    /**
     * Relay video player action
     */
    socket.on('videoPlayer', (config) => {
        let room_id = config.room_id;
        let peer_name = config.peer_name;
        let video_action = config.video_action;
        let video_src = config.video_src;
        let peer_id = config.peer_id;

        let sendConfig = {
            peer_name: peer_name,
            video_action: video_action,
            video_src: video_src,
        };
        let logme = {
            peer_id: socket.id,
            peer_name: peer_name,
            video_action: video_action,
            video_src: video_src,
        };

        if (peer_id) {
            log.debug(
                '[' + socket.id + '] emit videoPlayer to [' + peer_id + '] from room_id [' + room_id + ']',
                logme,
            );

            sendToPeer(peer_id, sockets, 'videoPlayer', sendConfig);
        } else {
            log.debug('[' + socket.id + '] emit videoPlayer to [room_id: ' + room_id + ']', logme);

            sendToRoom(room_id, socket.id, 'videoPlayer', sendConfig);
        }
    });

    /**
     * Whiteboard actions for all user in the same room
     */
    socket.on('wbCanvasToJson', (config) => {
        let room_id = config.room_id;
        // log.debug('Whiteboard send canvas', config);
        sendToRoom(room_id, socket.id, 'wbCanvasToJson', config);
    });

    socket.on('whiteboardAction', (config) => {
        log.debug('Whiteboard', config);
        let room_id = config.room_id;
        sendToRoom(room_id, socket.id, 'whiteboardAction', config);
    });
}); // end [sockets.on-connect]

/**
 * Send async data to all peers in the same room except yourself
 * @param {*} room_id id of the room to send data
 * @param {*} socket_id socket id of peer that send data
 * @param {*} msg message to send to the peers in the same room
 * @param {*} config JSON data to send to the peers in the same room
 */
async function sendToRoom(room_id, socket_id, msg, config = {}) {
    for (let peer_id in channels[room_id]) {
        // not send data to myself
        if (peer_id != socket_id) {
            await channels[room_id][peer_id].emit(msg, config);
        }
    }
}

/**
 * Send async data to specified peer
 * @param {*} peer_id id of the peer to send data
 * @param {*} sockets all peers connections
 * @param {*} msg message to send to the peer in the same room
 * @param {*} config JSON data to send to the peer in the same room
 */
async function sendToPeer(peer_id, sockets, msg, config = {}) {
    if (peer_id in sockets) {
        await sockets[peer_id].emit(msg, config);
    }
}
