const express = require('express');
const session = require('express-session');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ===== CONFIG =====
const PORT = process.env.PORT || 3000;
const SITE_PASSWORD = process.env.SITE_PASSWORD || 'amoalara1910';
const SESSION_SECRET = process.env.SESSION_SECRET || 'wancord-troque-esse-segredo';

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 dias
});

app.use(sessionMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// compartilha a sessão do express com o socket.io
io.engine.use(sessionMiddleware);

// ===== ROTAS DE AUTENTICAÇÃO =====
app.get('/', (req, res) => {
  if (req.session && req.session.authed) {
    return res.sendFile(path.join(__dirname, 'public', 'app.html'));
  }
  return res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === SITE_PASSWORD) {
    req.session.authed = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Senha incorreta.' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// bloqueia acesso direto ao app.html sem sessão
app.get('/app.html', (req, res) => {
  if (req.session && req.session.authed) {
    return res.sendFile(path.join(__dirname, 'public', 'app.html'));
  }
  return res.redirect('/');
});

// assets estáticos (css/js) - sem dado sensível, ok liberar
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));

// ===== ESTADO EM MEMÓRIA =====
const servers = new Map();
const channelMessages = new Map();
// membros conectados na chamada de voz por canal: Map<channelId, Map<socketId, username>>
const voiceMembers = new Map();
const socketUsers = new Map();

function genId() {
  return crypto.randomBytes(6).toString('hex');
}

function publicServerList() {
  return Array.from(servers.values()).map(s => ({
    id: s.id,
    name: s.name,
    isPrivate: s.isPrivate,
    ownerName: s.ownerName,
    channels: s.channels,
    memberCount: s.memberNames.size
  }));
}

function broadcastVoiceRoom(channelId) {
  const room = voiceMembers.get(channelId);
  const members = room ? Array.from(room.entries()).map(([socketId, uname]) => ({ socketId, username: uname })) : [];
  io.emit('voice-room-update', { channelId, members });
}

function createDefaultServer() {
  const id = genId();
  const textCh = { id: genId(), name: 'geral', type: 'text' };
  const voiceCh = { id: genId(), name: 'Sala de Voz', type: 'voice' };
  servers.set(id, {
    id,
    name: 'Wancord Geral',
    isPrivate: false,
    password: null,
    ownerName: 'Wancord',
    channels: [textCh, voiceCh],
    memberNames: new Set()
  });
  channelMessages.set(textCh.id, []);
}
createDefaultServer();

// ===== SOCKET.IO =====
io.use((socket, next) => {
  const sess = socket.request.session;
  if (sess && sess.authed) return next();
  next(new Error('unauthorized'));
});

io.on('connection', (socket) => {
  let username = null;

  socket.on('identify', (name) => {
    username = (name || 'Convidado').toString().trim().slice(0, 24) || 'Convidado';
    socketUsers.set(socket.id, username);
    socket.emit('servers-list', publicServerList());
    // manda o estado atual de todas as salas de voz que existem agora
    for (const [channelId, room] of voiceMembers) {
      const members = Array.from(room.entries()).map(([sid, uname]) => ({ socketId: sid, username: uname }));
      socket.emit('voice-room-update', { channelId, members });
    }
  });

  socket.on('create-server', ({ name, isPrivate, password }) => {
    if (!username) return;
    name = (name || '').toString().trim().slice(0, 40);
    if (!name) return socket.emit('error-msg', 'Nome do servidor inválido.');
    const id = genId();
    const textCh = { id: genId(), name: 'geral', type: 'text' };
    const voiceCh = { id: genId(), name: 'Sala de Voz', type: 'voice' };
    servers.set(id, {
      id,
      name,
      isPrivate: !!isPrivate,
      password: isPrivate ? (password || '') : null,
      ownerName: username,
      channels: [textCh, voiceCh],
      memberNames: new Set([username])
    });
    channelMessages.set(textCh.id, []);
    io.emit('servers-list', publicServerList());
    socket.emit('server-created', { serverId: id, inviteCode: id });
  });

  socket.on('join-server', ({ serverId, password }) => {
    const s = servers.get(serverId);
    if (!s) return socket.emit('error-msg', 'Servidor não encontrado. Verifique o código de convite.');
    if (s.isPrivate && s.password !== (password || '')) {
      return socket.emit('error-msg', 'Senha do servidor incorreta.');
    }
    s.memberNames.add(username);
    io.emit('servers-list', publicServerList());
    socket.emit('joined-server', { serverId });
  });

  socket.on('create-channel', ({ serverId, name, type }) => {
    const s = servers.get(serverId);
    if (!s || !s.memberNames.has(username)) return;
    name = (name || '').toString().trim().slice(0, 30);
    type = type === 'voice' ? 'voice' : 'text';
    if (!name) return;
    const ch = { id: genId(), name, type };
    s.channels.push(ch);
    if (type === 'text') channelMessages.set(ch.id, []);
    io.emit('servers-list', publicServerList());
  });

  socket.on('get-channel-messages', (channelId) => {
    socket.emit('channel-messages', {
      channelId,
      messages: channelMessages.get(channelId) || []
    });
  });

  socket.on('send-message', ({ channelId, text }) => {
    if (!username) return;
    text = (text || '').toString().slice(0, 2000);
    if (!text.trim()) return;
    const msg = { user: username, text, time: Date.now() };
    if (!channelMessages.has(channelId)) channelMessages.set(channelId, []);
    channelMessages.get(channelId).push(msg);
    io.emit('new-message', { channelId, message: msg });
  });

  // ===== VOZ / VIDEO / SCREEN SHARE (sinalização WebRTC) =====
  socket.on('join-voice', (channelId) => {
    if (!voiceMembers.has(channelId)) voiceMembers.set(channelId, new Map());
    const room = voiceMembers.get(channelId);

    const existing = Array.from(room.entries()).map(([sid, uname]) => ({ socketId: sid, username: uname }));
    socket.join('voice-' + channelId);
    room.set(socket.id, username);

    socket.emit('voice-existing-peers', existing);

    socket.to('voice-' + channelId).emit('voice-peer-joined', {
      socketId: socket.id,
      username
    });

    socket.data.currentVoiceChannel = channelId;
    broadcastVoiceRoom(channelId);
  });

  socket.on('voice-signal', ({ to, data }) => {
    io.to(to).emit('voice-signal', { from: socket.id, data, username });
  });

  socket.on('leave-voice', (channelId) => {
    leaveVoiceChannel(socket, channelId);
  });

  socket.on('video-status', ({ channelId, hasVideo, kind }) => {
    socket.to('voice-' + channelId).emit('peer-video-status', { socketId: socket.id, hasVideo, kind });
  });

  function leaveVoiceChannel(socket, channelId) {
    if (!channelId) return;
    const room = voiceMembers.get(channelId);
    if (room) {
      room.delete(socket.id);
      if (room.size === 0) voiceMembers.delete(channelId);
    }
    socket.leave('voice-' + channelId);
    socket.to('voice-' + channelId).emit('voice-peer-left', { socketId: socket.id });
    if (socket.data.currentVoiceChannel === channelId) {
      socket.data.currentVoiceChannel = null;
    }
    broadcastVoiceRoom(channelId);
  }

  socket.on('disconnect', () => {
    if (socket.data.currentVoiceChannel) {
      leaveVoiceChannel(socket, socket.data.currentVoiceChannel);
    }
    socketUsers.delete(socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Wancord rodando na porta ${PORT}`);
});
