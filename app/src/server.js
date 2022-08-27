/*
http://patorjk.com/software/taag/#p=display&f=ANSI%20Regular&t=Server

███████ ███████ ██████  ██    ██ ███████ ██████  
██      ██      ██   ██ ██    ██ ██      ██   ██ 
███████ █████   ██████  ██    ██ █████   ██████  
     ██ ██      ██   ██  ██  ██  ██      ██   ██ 
███████ ███████ ██   ██   ████   ███████ ██   ██                                           

dependencies: {
    body-parser             : https://www.npmjs.com/package/body-parser
    compression             : https://www.npmjs.com/package/compression
    cors                    : https://www.npmjs.com/package/cors
    crypto-js               : https://www.npmjs.com/package/crypto-js
    dotenv                  : https://www.npmjs.com/package/dotenv
    express                 : https://www.npmjs.com/package/express
    ngrok                   : https://www.npmjs.com/package/ngrok
    qs                      : https://www.npmjs.com/package/qs
    @sentry/node            : https://www.npmjs.com/package/@sentry/node
    @sentry/integrations    : https://www.npmjs.com/package/@sentry/integrations
    socket.io               : https://www.npmjs.com/package/socket.io
    swagger                 : https://www.npmjs.com/package/swagger-ui-express
    uuid                    : https://www.npmjs.com/package/uuid
    yamljs                  : https://www.npmjs.com/package/yamljs
}
*/

/**
 * MiroTalk P2P - Server component
 *
 * @link    GitHub: https://github.com/miroslavpejic85/mirotalk
 * @link    Live demo: https://p2p.mirotalk.com or https://mirotalk.up.railway.app or https://mirotalk.herokuapp.com
 * @license For open source use: AGPLv3
 * @license For commercial or closed source, contact us at info.mirotalk@gmail.com
 * @author  Miroslav Pejic - miroslav.pejic.85@gmail.com
 * @version 1.0.1
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
    transports: ['websocket'],
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
const ngrokEnabled = process.env.NGROK_ENABLED || false;
const ngrokAuthToken = process.env.NGROK_AUTH_TOKEN;

// Stun config
const stun = process.env.STUN || 'stun:stun.l.google.com:19302';

// Turn config
const turnEnabled = process.env.TURN_ENABLED || false;
const turnUrls = process.env.TURN_URLS;
const turnUsername = process.env.TURN_USERNAME;
const turnCredential = process.env.TURN_PASSWORD;

// Sentry config
const Sentry = require('@sentry/node');
const { CaptureConsole } = require('@sentry/integrations');
const sentryEnabled = process.env.SENTRY_ENABLED || false;
const sentryDSN = process.env.SENTRY_DSN;
const sentryTracesSampleRate = process.env.SENTRY_TRACES_SAMPLE_RATE;

// Slack API
const CryptoJS = require('crypto-js');
const qS = require('qs');
const slackEnabled = process.env.SENTRY_ENABLED || false;
const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
const bodyParser = require('body-parser');

// Setup sentry client
if (sentryEnabled == 'true') {
    Sentry.init({
        dsn: sentryDSN,
        integrations: [
            new CaptureConsole({
                // array of methods that should be captured
                // defaults to ['log', 'info', 'warn', 'error', 'debug', 'assert']
                levels: ['warn', 'error'],
            }),
        ],
        // Set tracesSampleRate to 1.0 to capture 100%
        // of transactions for performance monitoring.
        // We recommend adjusting this value in production
        tracesSampleRate: sentryTracesSampleRate,
    });
}

// directory
const dir = {
    public: path.join(__dirname, '../../', 'public'),
};
// html views
const views = {
    about: path.join(__dirname, '../../', 'public/views/about.html'),
    client: path.join(__dirname, '../../', 'public/views/client.html'),
    landing: path.join(__dirname, '../../', 'public/views/landing.html'),
    newCall: path.join(__dirname, '../../', 'public/views/newcall.html'),
    notFound: path.join(__dirname, '../../', 'public/views/404.html'),
    permission: path.join(__dirname, '../../', 'public/views/permission.html'),
    privacy: path.join(__dirname, '../../', 'public/views/privacy.html'),
    stunTurn: path.join(__dirname, '../../', 'public/views/testStunTurn.html'),
};

let channels = {}; // collect channels
let sockets = {}; // collect sockets
let peers = {}; // collect peers info grp by channels

app.use(cors()); // Enable All CORS Requests for all origins
app.use(compression()); // Compress all HTTP responses using GZip
app.use(express.json()); // Api parse body data as json
app.use(express.static(dir.public)); // Use all static files from the public folder
app.use(bodyParser.urlencoded({ extended: true })); // Need for Slack API body parser

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
    res.sendFile(views.landing);
});

// mirotalk about
app.get(['/about'], (req, res) => {
    res.sendFile(views.about);
});

// set new room name and join
app.get(['/newcall'], (req, res) => {
    res.sendFile(views.newCall);
});

// if not allow video/audio
app.get(['/permission'], (req, res) => {
    res.sendFile(views.permission);
});

// privacy policy
app.get(['/privacy'], (req, res) => {
    res.sendFile(views.privacy);
});

// test Stun and Turn connections
app.get(['/test'], (req, res) => {
    if (Object.keys(req.query).length > 0) {
        log.debug('Request Query', req.query);
    }
    /*
        http://localhost:3000/test?iceServers=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:openrelay.metered.ca:443","username":"openrelayproject","credential":"openrelayproject"}]
        https://p2p.mirotalk.com//test?iceServers=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:openrelay.metered.ca:443","username":"openrelayproject","credential":"openrelayproject"}]
        https://mirotalk.up.railway.app/test?iceServers=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:openrelay.metered.ca:443","username":"openrelayproject","credential":"openrelayproject"}]
        https://mirotalk.herokuapp.com/test?iceServers=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:openrelay.metered.ca:443","username":"openrelayproject","credential":"openrelayproject"}]
    */
    res.sendFile(views.stunTurn);
});

// no room name specified to join
app.get('/join/', (req, res) => {
    if (Object.keys(req.query).length > 0) {
        log.debug('Request Query', req.query);
        /* 
            http://localhost:3000/join?room=test&name=mirotalk&audio=1&video=1&screen=1&notify=1
            https://p2p.mirotalk.com/join?room=test&name=mirotalk&audio=1&video=1&screen=1&notify=1
            https://mirotalk.up.railway.app/join?room=test&name=mirotalk&audio=1&video=1&screen=1&notify=1
            https://mirotalk.herokuapp.com/join?room=test&name=mirotalk&audio=1&video=1&screen=1&notify=1
        */
        const { room, name, audio, video, screen, notify } = req.query;
        // all the params are mandatory for the direct room join
        if (room && name && audio && video && screen && notify) {
            return res.sendFile(views.client);
        }
    }
    res.redirect('/');
});

// Join Room *
app.get('/join/*', (req, res) => {
    res.sendFile(views.client);
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

/*
    MiroTalk Slack app v1
    https://api.slack.com/authentication/verifying-requests-from-slack
*/

//Slack request meeting room endpoint
app.post('/slack', (req, res) => {
    if (slackEnabled != 'true') return res.end('`Under maintenance` - Please check back soon.');

    log.debug('Slack', req.headers);

    if (!slackSigningSecret) return res.end('`Slack Signing Secret is empty!`');

    let slackSignature = req.headers['x-slack-signature'];
    let requestBody = qS.stringify(req.body, { format: 'RFC1738' });
    let timeStamp = req.headers['x-slack-request-timestamp'];
    let time = Math.floor(new Date().getTime() / 1000);

    // The request timestamp is more than five minutes from local time. It could be a replay attack, so let's ignore it.
    if (Math.abs(time - timeStamp) > 300) return res.end('`Wrong timestamp` - Ignore this request.');

    // Get Signature to compare it later
    let sigBaseString = 'v0:' + timeStamp + ':' + requestBody;
    let mySignature = 'v0=' + CryptoJS.HmacSHA256(sigBaseString, slackSigningSecret);

    // Valid Signature return a meetingURL
    if (mySignature == slackSignature) {
        let host = req.headers.host;
        let meetingURL = getMeetingURL(host);
        log.debug('Slack', { meeting: meetingURL });
        return res.end(meetingURL);
    }
    // Something wrong
    return res.end('`Wrong signature` - Verification failed!');
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
    res.sendFile(views.notFound);
});

/**
 * You should probably use a different stun-turn server
 * doing commercial stuff, also see:
 *
 * https://github.com/coturn/coturn
 * https://gist.github.com/zziuni/3741933
 * https://www.twilio.com/docs/stun-turn
 *
 * Check the functionality of STUN/TURN servers:
 * https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
 */
const iceServers = [];

// Stun is always needed
iceServers.push({ urls: stun });

if (turnEnabled == 'true') {
    iceServers.push({
        urls: turnUrls,
        username: turnUsername,
        credential: turnCredential,
    });
} else {
    // As backup if not configured, please configure your own in the .env file
    // https://www.metered.ca/tools/openrelay/
    iceServers.push({
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject',
    });
}

// Test Stun and Turn connection with query params
const testStunTurn = host + '/test?iceServers=' + JSON.stringify(iceServers);

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
            test_ice_servers: testStunTurn,
            api_docs: api_docs,
            api_key_secret: api_key_secret,
            sentry_enabled: sentryEnabled,
            node_version: process.versions.node,
        });
    } catch (err) {
        log.warn('[Error] ngrokStart', err.body);
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
            test_ice_servers: testStunTurn,
            api_docs: api_docs,
            api_key_secret: api_key_secret,
            sentry_enabled: sentryEnabled,
            node_version: process.versions.node,
        });
    }
});

/**
 * On peer connected
 * Users will connect to the signaling server, after which they'll issue a "join"
 * to join a particular channel. The signaling server keeps track of all sockets
 * who are in a channel, and on join will send out 'addPeer' events to each pair
 * of users in a channel. When clients receive the 'addPeer' even they'll begin
 * setting up an RTCPeerConnection with one another. During this process they'll
 * need to relay ICECandidate information to one another, as well as SessionDescription
 * information. After all of that happens, they'll finally be able to complete
 * the peer connection and will be in streaming audio/video between eachother.
 */
io.sockets.on('connect', async (socket) => {
    log.debug('[' + socket.id + '] connection accepted', { host: socket.handshake.headers.host.split(':')[0] });

    socket.channels = {};
    sockets[socket.id] = socket;

    const transport = socket.conn.transport.name; // in most cases, "polling"
    log.debug('[' + socket.id + '] Connection transport', transport);

    /**
     * Check upgrade transport
     */
    socket.conn.on('upgrade', () => {
        const upgradedTransport = socket.conn.transport.name; // in most cases, "websocket"
        log.debug('[' + socket.id + '] Connection upgraded transport', upgradedTransport);
    });

    /**
     * On peer diconnected
     */
    socket.on('disconnect', async (reason) => {
        for (let channel in socket.channels) {
            await removePeerFrom(channel);
        }
        log.debug('[' + socket.id + '] disconnected', { reason: reason });
        delete sockets[socket.id];
    });

    /**
     * On peer join
     */
    socket.on('join', async (config) => {
        // log.debug('Join room', config);
        log.debug('[' + socket.id + '] join ', config);

        let channel = config.channel;
        let channel_password = config.channel_password;
        let peer_name = config.peer_name;
        let peer_video = config.peer_video;
        let peer_audio = config.peer_audio;
        let peer_video_status = config.peer_video_status;
        let peer_audio_status = config.peer_audio_status;
        let peer_hand_status = config.peer_hand_status;
        let peer_rec_status = config.peer_rec_status;

        if (channel in socket.channels) {
            log.debug('[' + socket.id + '] [Warning] already joined', channel);
            return;
        }
        // no channel aka room in channels init
        if (!(channel in channels)) channels[channel] = {};

        // no channel aka room in peers init
        if (!(channel in peers)) peers[channel] = {};

        // room locked by the participants can't join
        if (peers[channel]['lock'] === true && peers[channel]['password'] != channel_password) {
            log.debug('[' + socket.id + '] [Warning] Room Is Locked', channel);
            socket.emit('roomIsLocked');
            return;
        }

        // collect peers info grp by channels
        peers[channel][socket.id] = {
            peer_name: peer_name,
            peer_video: peer_video,
            peer_audio: peer_audio,
            peer_video_status: peer_video_status,
            peer_audio_status: peer_audio_status,
            peer_hand_status: peer_hand_status,
            peer_rec_status: peer_rec_status,
        };
        log.debug('[Join] - connected peers grp by roomId', peers);

        await addPeerTo(channel);

        channels[channel][socket.id] = socket;
        socket.channels[channel] = channel;

        // Send some server info to joined peer
        await sendToPeer(socket.id, sockets, 'serverInfo', { peers_count: Object.keys(peers[channel]).length });
    });

    /**
     * Add peers to channel
     * @param {string} channel room id
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
     * Remove peers from channel
     * @param {string} channel room id
     */
    async function removePeerFrom(channel) {
        if (!(channel in socket.channels)) {
            log.debug('[' + socket.id + '] [Warning] not in ', channel);
            return;
        }
        try {
            delete socket.channels[channel];
            delete channels[channel][socket.id];
            delete peers[channel][socket.id]; // delete peer data from the room

            switch (Object.keys(peers[channel]).length) {
                case 0: // last peer disconnected from the room without room lock & password set
                    delete peers[channel];
                    break;
                case 2: // last peer disconnected from the room having room lock & password set
                    if (peers[channel]['lock'] && peers[channel]['password']) {
                        delete peers[channel]; // clean lock and password value from the room
                    }
                    break;
            }
        } catch (err) {
            log.error('Remove Peer', toJson(err));
        }
        log.debug('[removePeerFrom] - connected peers grp by roomId', peers);

        for (let id in channels[channel]) {
            await channels[channel][id].emit('removePeer', { peer_id: socket.id });
            socket.emit('removePeer', { peer_id: id });
            log.debug('[' + socket.id + '] emit removePeer [' + id + ']');
        }
    }

    /**
     * Relay ICE to peers
     */
    socket.on('relayICE', async (config) => {
        let peer_id = config.peer_id;
        let ice_candidate = config.ice_candidate;

        // log.debug('[' + socket.id + '] relay ICE-candidate to [' + peer_id + '] ', {
        //     address: config.ice_candidate,
        // });

        await sendToPeer(peer_id, sockets, 'iceCandidate', {
            peer_id: socket.id,
            ice_candidate: ice_candidate,
        });
    });

    /**
     * Relay SDP to peers
     */
    socket.on('relaySDP', async (config) => {
        let peer_id = config.peer_id;
        let session_description = config.session_description;

        log.debug('[' + socket.id + '] relay SessionDescription to [' + peer_id + '] ', {
            type: session_description.type,
        });

        await sendToPeer(peer_id, sockets, 'sessionDescription', {
            peer_id: socket.id,
            session_description: session_description,
        });
    });

    /**
     * Handle Room action
     */
    socket.on('roomAction', async (config) => {
        //log.debug('[' + socket.id + '] Room action:', config);
        let room_is_locked = false;
        let room_id = config.room_id;
        let peer_name = config.peer_name;
        let password = config.password;
        let action = config.action;
        //
        try {
            switch (action) {
                case 'lock':
                    peers[room_id]['lock'] = true;
                    peers[room_id]['password'] = password;
                    await sendToRoom(room_id, socket.id, 'roomAction', {
                        peer_name: peer_name,
                        action: action,
                    });
                    room_is_locked = true;
                    break;
                case 'unlock':
                    delete peers[room_id]['lock'];
                    delete peers[room_id]['password'];
                    await sendToRoom(room_id, socket.id, 'roomAction', {
                        peer_name: peer_name,
                        action: action,
                    });
                    break;
                case 'checkPassword':
                    let config = {
                        peer_name: peer_name,
                        action: action,
                        password: password == peers[room_id]['password'] ? 'OK' : 'KO',
                    };
                    await sendToPeer(socket.id, sockets, 'roomAction', config);
                    break;
            }
        } catch (err) {
            log.error('Room action', toJson(err));
        }
        log.debug('[' + socket.id + '] Room ' + room_id, { locked: room_is_locked, password: password });
    });

    /**
     * Relay NAME to peers
     */
    socket.on('peerName', async (config) => {
        // log.debug('Peer name', config);
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

            await sendToRoom(room_id, socket.id, 'peerName', {
                peer_id: peer_id_to_update,
                peer_name: peer_name_new,
            });
        }
    });

    /**
     * Relay Audio Video Hand ... Status to peers
     */
    socket.on('peerStatus', async (config) => {
        // log.debug('Peer status', config);
        let room_id = config.room_id;
        let peer_name = config.peer_name;
        let element = config.element;
        let status = config.status;
        try {
            for (let peer_id in peers[room_id]) {
                if (peers[room_id][peer_id]['peer_name'] == peer_name) {
                    switch (element) {
                        case 'video':
                            peers[room_id][peer_id]['peer_video_status'] = status;
                            break;
                        case 'audio':
                            peers[room_id][peer_id]['peer_audio_status'] = status;
                            break;
                        case 'hand':
                            peers[room_id][peer_id]['peer_hand_status'] = status;
                            break;
                        case 'rec':
                            peers[room_id][peer_id]['peer_rec_status'] = status;
                            break;
                    }
                }
            }

            log.debug('[' + socket.id + '] emit peerStatus to [room_id: ' + room_id + ']', {
                peer_id: socket.id,
                element: element,
                status: status,
            });

            await sendToRoom(room_id, socket.id, 'peerStatus', {
                peer_id: socket.id,
                peer_name: peer_name,
                element: element,
                status: status,
            });
        } catch (err) {
            log.error('Peer Status', toJson(err));
        }
    });

    /**
     * Relay actions to peers or specific peer in the same room
     */
    socket.on('peerAction', async (config) => {
        // log.debug('Peer action', config);
        let room_id = config.room_id;
        let peer_id = config.peer_id;
        let peer_name = config.peer_name;
        let peer_use_video = config.peer_use_video;
        let peer_action = config.peer_action;
        let send_to_all = config.send_to_all;

        if (send_to_all) {
            log.debug('[' + socket.id + '] emit peerAction to [room_id: ' + room_id + ']', {
                peer_id: socket.id,
                peer_name: peer_name,
                peer_action: peer_action,
                peer_use_video: peer_use_video,
            });

            await sendToRoom(room_id, socket.id, 'peerAction', {
                peer_id: peer_id,
                peer_name: peer_name,
                peer_action: peer_action,
                peer_use_video: peer_use_video,
            });
        } else {
            log.debug('[' + socket.id + '] emit peerAction to [' + peer_id + '] from room_id [' + room_id + ']');

            await sendToPeer(peer_id, sockets, 'peerAction', {
                peer_id: peer_id,
                peer_name: peer_name,
                peer_action: peer_action,
                peer_use_video: peer_use_video,
            });
        }
    });

    /**
     * Relay Kick out peer from room
     */
    socket.on('kickOut', async (config) => {
        let room_id = config.room_id;
        let peer_id = config.peer_id;
        let peer_name = config.peer_name;

        log.debug('[' + socket.id + '] kick out peer [' + peer_id + '] from room_id [' + room_id + ']');

        await sendToPeer(peer_id, sockets, 'kickOut', {
            peer_name: peer_name,
        });
    });

    /**
     * Relay File info
     */
    socket.on('fileInfo', async (config) => {
        // log.debug('File info', config);
        let room_id = config.room_id;
        let peer_name = config.peer_name;
        let peer_id = config.peer_id;
        let broadcast = config.broadcast;
        let file = config.file;

        function bytesToSize(bytes) {
            let sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
            if (bytes == 0) return '0 Byte';
            let i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
            return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
        }

        log.debug('[' + socket.id + '] Peer [' + peer_name + '] send file to room_id [' + room_id + ']', {
            peerName: file.peerName,
            fileName: file.fileName,
            fileSize: bytesToSize(file.fileSize),
            fileType: file.fileType,
            broadcast: broadcast,
        });

        if (broadcast) {
            await sendToRoom(room_id, socket.id, 'fileInfo', config);
        } else {
            await sendToPeer(peer_id, sockets, 'fileInfo', config);
        }
    });

    /**
     * Abort file sharing
     */
    socket.on('fileAbort', async (config) => {
        let room_id = config.room_id;
        let peer_name = config.peer_name;

        log.debug('[' + socket.id + '] Peer [' + peer_name + '] send fileAbort to room_id [' + room_id + ']');
        await sendToRoom(room_id, socket.id, 'fileAbort');
    });

    /**
     * Relay video player action
     */
    socket.on('videoPlayer', async (config) => {
        // log.debug('Video player', config);
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
        let logMe = {
            peer_id: socket.id,
            peer_name: peer_name,
            video_action: video_action,
            video_src: video_src,
        };

        if (peer_id) {
            log.debug(
                '[' + socket.id + '] emit videoPlayer to [' + peer_id + '] from room_id [' + room_id + ']',
                logMe,
            );

            await sendToPeer(peer_id, sockets, 'videoPlayer', sendConfig);
        } else {
            log.debug('[' + socket.id + '] emit videoPlayer to [room_id: ' + room_id + ']', logMe);

            await sendToRoom(room_id, socket.id, 'videoPlayer', sendConfig);
        }
    });

    /**
     * Whiteboard actions for all user in the same room
     */
    socket.on('wbCanvasToJson', async (config) => {
        // log.debug('Whiteboard send canvas', config);
        let room_id = config.room_id;
        await sendToRoom(room_id, socket.id, 'wbCanvasToJson', config);
    });

    socket.on('whiteboardAction', async (config) => {
        log.debug('Whiteboard', config);
        let room_id = config.room_id;
        await sendToRoom(room_id, socket.id, 'whiteboardAction', config);
    });
}); // end [sockets.on-connect]

/**
 * Object to Json
 * @param {object} data object
 * @returns {json} indent 4 spaces
 */
function toJson(data) {
    return JSON.stringify(data, null, 4); // "\t"
}

/**
 * Send async data to all peers in the same room except yourself
 * @param {string} room_id id of the room to send data
 * @param {string} socket_id socket id of peer that send data
 * @param {string} msg message to send to the peers in the same room
 * @param {object} config data to send to the peers in the same room
 */
async function sendToRoom(room_id, socket_id, msg, config = {}) {
    for (let peer_id in channels[room_id]) {
        // not send data to myself
        if (peer_id != socket_id) {
            await channels[room_id][peer_id].emit(msg, config);
            //console.log('Send to room', { msg: msg, config: config });
        }
    }
}

/**
 * Send async data to specified peer
 * @param {string} peer_id id of the peer to send data
 * @param {object} sockets all peers connections
 * @param {string} msg message to send to the peer in the same room
 * @param {object} config data to send to the peer in the same room
 */
async function sendToPeer(peer_id, sockets, msg, config = {}) {
    if (peer_id in sockets) {
        await sockets[peer_id].emit(msg, config);
        //console.log('Send to peer', { msg: msg, config: config });
    }
}
