const socket = io();

let username = localStorage.getItem('wancord_username') || '';
let servers = [];
let currentServerId = null;
let currentChannelId = null;
let currentChannelType = null;

// ===== WebRTC state =====
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};
let micStream = null;
let micTrack = null;
let camTrack = null;
let screenTrack = null;
let activeVideoTrack = null; // referência à track de vídeo atualmente enviada (câmera OU tela)
let micOn = true;
let camOn = false;
let isScreenSharing = false;
let deafened = false;

const peers = {};          // socketId -> RTCPeerConnection
const peerUsernames = {};  // socketId -> username
const peerStreams = {};    // socketId -> MediaStream (áudio/vídeo remoto acumulado)

// membros de cada sala de voz (para mostrar embaixo do canal na sidebar)
let voiceRoomMembers = {}; // channelId -> [{socketId, username}]

// ===== ELEMENTS =====
const usernameModal = document.getElementById('usernameModal');
const usernameInput = document.getElementById('usernameInput');
const usernameConfirm = document.getElementById('usernameConfirm');

const createServerModal = document.getElementById('createServerModal');
const joinServerModal = document.getElementById('joinServerModal');
const createChannelModal = document.getElementById('createChannelModal');
const inviteModal = document.getElementById('inviteModal');

const serverIconList = document.getElementById('serverIconList');
const channelList = document.getElementById('channelList');
const currentServerNameEl = document.getElementById('currentServerName');
const currentChannelNameEl = document.getElementById('currentChannelName');
const userNameDisplay = document.getElementById('userNameDisplay');
const userAvatarInitial = document.getElementById('userAvatarInitial');

const textView = document.getElementById('textView');
const voiceView = document.getElementById('voiceView');
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const videoGrid = document.getElementById('videoGrid');

// ===== USERNAME SETUP =====
function initUsername() {
  if (username) {
    usernameModal.classList.add('hidden');
    afterIdentify();
  } else {
    usernameModal.classList.remove('hidden');
  }
}
usernameConfirm.addEventListener('click', () => {
  const val = usernameInput.value.trim();
  if (!val) return;
  username = val.slice(0, 24);
  localStorage.setItem('wancord_username', username);
  usernameModal.classList.add('hidden');
  afterIdentify();
});
usernameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') usernameConfirm.click(); });

function afterIdentify() {
  userNameDisplay.textContent = username;
  userAvatarInitial.textContent = username.charAt(0).toUpperCase();
  socket.emit('identify', username);
}

socket.on('connect', () => { if (username) afterIdentify(); });
initUsername();

// ===== SERVER LIST =====
socket.on('servers-list', (list) => {
  servers = list;
  renderServerRail();
  if (currentServerId) renderChannelList();
});

function renderServerRail() {
  serverIconList.innerHTML = '';
  servers.forEach(s => {
    const div = document.createElement('div');
    div.className = 'server-icon' + (s.id === currentServerId ? ' active' : '');
    div.title = s.name + (s.isPrivate ? ' (privado)' : '');
    div.textContent = initials(s.name);
    div.addEventListener('click', () => selectServer(s.id));
    serverIconList.appendChild(div);
  });
}

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function selectServer(serverId) {
  currentServerId = serverId;
  currentChannelId = null;
  renderServerRail();
  renderChannelList();
}

function renderChannelList() {
  const s = servers.find(x => x.id === currentServerId);
  if (!s) { currentServerNameEl.textContent = 'Selecione um servidor'; channelList.innerHTML = ''; return; }
  currentServerNameEl.textContent = s.name;
  channelList.innerHTML = '';
  s.channels.forEach(ch => {
    const div = document.createElement('div');
    div.className = 'channel-item' + (ch.id === currentChannelId ? ' active' : '');
    div.innerHTML = `<span class="hash">${ch.type === 'voice' ? '🔊' : '#'}</span> ${escapeHtml(ch.name)}`;
    div.addEventListener('click', () => selectChannel(ch));
    channelList.appendChild(div);

    // se for canal de voz e tiver gente conectada, lista os nomes embaixo (some quando não tem ninguém)
    if (ch.type === 'voice') {
      const members = voiceRoomMembers[ch.id] || [];
      members.forEach(m => {
        const row = document.createElement('div');
        row.className = 'voice-member-row';
        row.innerHTML = `<span class="mini-avatar">${escapeHtml(m.username.charAt(0).toUpperCase())}</span> ${escapeHtml(m.username)}`;
        channelList.appendChild(row);
      });
    }
  });
  const createLink = document.createElement('div');
  createLink.className = 'create-channel-link';
  createLink.innerHTML = '<span>+ Criar canal</span>';
  createLink.addEventListener('click', () => createChannelModal.classList.remove('hidden'));
  channelList.appendChild(createLink);
}

// atualiza a lista de quem está em cada sala de voz (aparece/some em tempo real)
socket.on('voice-room-update', ({ channelId, members }) => {
  voiceRoomMembers[channelId] = members;
  if (currentServerId) renderChannelList();
});

function selectChannel(ch) {
  if (currentChannelType === 'voice' && currentChannelId && currentChannelId !== ch.id) {
    leaveVoice();
  }
  currentChannelId = ch.id;
  currentChannelType = ch.type;
  currentChannelNameEl.textContent = (ch.type === 'voice' ? '🔊 ' : '# ') + ch.name;
  renderChannelList();

  if (ch.type === 'text') {
    textView.classList.remove('hidden');
    voiceView.classList.add('hidden');
    messagesContainer.innerHTML = '';
    socket.emit('get-channel-messages', ch.id);
  } else {
    textView.classList.add('hidden');
    voiceView.classList.remove('hidden');
    joinVoice(ch.id);
  }
}

// ===== CREATE SERVER =====
document.getElementById('openCreateServer').addEventListener('click', () => createServerModal.classList.remove('hidden'));
document.getElementById('cancelCreateServer').addEventListener('click', () => createServerModal.classList.add('hidden'));
document.getElementById('newServerPrivate').addEventListener('change', (e) => {
  document.getElementById('newServerPassword').classList.toggle('hidden', !e.target.checked);
});
document.getElementById('confirmCreateServer').addEventListener('click', () => {
  const name = document.getElementById('newServerName').value.trim();
  const isPrivate = document.getElementById('newServerPrivate').checked;
  const password = document.getElementById('newServerPassword').value;
  if (!name) return;
  socket.emit('create-server', { name, isPrivate, password });
  createServerModal.classList.add('hidden');
  document.getElementById('newServerName').value = '';
  document.getElementById('newServerPassword').value = '';
  document.getElementById('newServerPrivate').checked = false;
});
socket.on('server-created', ({ serverId, inviteCode }) => {
  document.getElementById('inviteCodeText').textContent = inviteCode;
  inviteModal.classList.remove('hidden');
  selectServer(serverId);
});
document.getElementById('closeInviteModal').addEventListener('click', () => inviteModal.classList.add('hidden'));

// ===== JOIN SERVER (invite code) =====
document.getElementById('openJoinServer').addEventListener('click', () => joinServerModal.classList.remove('hidden'));
document.getElementById('cancelJoinServer').addEventListener('click', () => joinServerModal.classList.add('hidden'));
document.getElementById('confirmJoinServer').addEventListener('click', () => {
  const serverId = document.getElementById('joinServerId').value.trim();
  const password = document.getElementById('joinServerPassword').value;
  if (!serverId) return;
  socket.emit('join-server', { serverId, password });
});
socket.on('joined-server', ({ serverId }) => {
  joinServerModal.classList.add('hidden');
  document.getElementById('joinServerId').value = '';
  document.getElementById('joinServerPassword').value = '';
  selectServer(serverId);
});
socket.on('error-msg', (msg) => alert(msg));

// ===== CREATE CHANNEL =====
document.getElementById('cancelCreateChannel').addEventListener('click', () => createChannelModal.classList.add('hidden'));
document.getElementById('confirmCreateChannel').addEventListener('click', () => {
  const name = document.getElementById('newChannelName').value.trim();
  const type = document.querySelector('input[name="chType"]:checked').value;
  if (!name || !currentServerId) return;
  socket.emit('create-channel', { serverId: currentServerId, name, type });
  createChannelModal.classList.add('hidden');
  document.getElementById('newChannelName').value = '';
});

// ===== CHAT =====
socket.on('channel-messages', ({ channelId, messages }) => {
  if (channelId !== currentChannelId) return;
  messagesContainer.innerHTML = '';
  messages.forEach(renderMessage);
  scrollToBottom();
});
socket.on('new-message', ({ channelId, message }) => {
  if (channelId !== currentChannelId) return;
  renderMessage(message);
  scrollToBottom();
});

function renderMessage(msg) {
  const row = document.createElement('div');
  row.className = 'message-row';
  const time = new Date(msg.time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  row.innerHTML = `
    <div class="avatar">${escapeHtml(msg.user.charAt(0).toUpperCase())}</div>
    <div class="body">
      <span class="author">${escapeHtml(msg.user)}</span><span class="time">${time}</span>
      <div class="text">${escapeHtml(msg.text)}</div>
    </div>`;
  messagesContainer.appendChild(row);
}

function scrollToBottom() { messagesContainer.scrollTop = messagesContainer.scrollHeight; }

function sendMessage() {
  const text = messageInput.value;
  if (!text.trim() || !currentChannelId) return;
  socket.emit('send-message', { channelId: currentChannelId, text });
  messageInput.value = '';
}
sendMessageBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ===== VOICE / VIDEO / SCREEN SHARE (WebRTC mesh, com perfect negotiation) =====

function ensureTile(id) {
  let tile = document.getElementById('tile-' + id);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = 'tile-' + id;
    tile.innerHTML = `
      <video autoplay playsinline></video>
      <div class="avatar-placeholder"></div>
      <div class="label"></div>
    `;
    videoGrid.appendChild(tile);
  }
  return tile;
}

function setTileInfo(id, name, isLocal) {
  const tile = ensureTile(id);
  tile.querySelector('.label').textContent = name + (isLocal ? ' (você)' : '');
  tile.querySelector('.avatar-placeholder').textContent = name.charAt(0).toUpperCase();
  if (isLocal) tile.querySelector('video').muted = true; // evita eco do próprio áudio
}

function setTileHasVideo(id, hasVideo) {
  const tile = document.getElementById('tile-' + id);
  if (!tile) return;
  tile.classList.toggle('has-video', hasVideo);
}

function setTileSharingScreen(id, sharing) {
  const tile = document.getElementById('tile-' + id);
  if (!tile) return;
  tile.classList.toggle('sharing-screen', sharing);
}

function removeTile(id) {
  const tile = document.getElementById('tile-' + id);
  if (tile) tile.remove();
}

async function joinVoice(channelId) {
  videoGrid.innerHTML = '';
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micTrack = micStream.getAudioTracks()[0];
    micTrack.enabled = micOn;
  } catch (err) {
    alert('Não foi possível acessar o microfone: ' + err.message);
  }

  // tile local aparece imediatamente com avatar (igual Discord)
  setTileInfo('local', username, true);

  socket.emit('join-voice', channelId);
}

// alguém que já estava na sala quando eu entrei -> aparece na hora
socket.on('voice-existing-peers', (peerList) => {
  peerList.forEach(p => {
    peerUsernames[p.socketId] = p.username;
    setTileInfo(p.socketId, p.username, false);
    createPeerConnection(p.socketId, true);
  });
});

// alguém entrou agora -> nome/avatar aparece na hora
socket.on('voice-peer-joined', ({ socketId, username: uname }) => {
  peerUsernames[socketId] = uname;
  setTileInfo(socketId, uname, false);
  createPeerConnection(socketId, false);
});

// alguém saiu -> nome/avatar some na hora
socket.on('voice-peer-left', ({ socketId }) => {
  if (peers[socketId]) { peers[socketId].close(); delete peers[socketId]; }
  delete peerStreams[socketId];
  delete peerUsernames[socketId];
  removeTile(socketId);
});

socket.on('peer-video-status', ({ socketId, hasVideo, kind }) => {
  setTileHasVideo(socketId, hasVideo);
  setTileSharingScreen(socketId, hasVideo && kind === 'screen');
});

// ===== Sinalização com "perfect negotiation" (evita a corrida que travava a tela ao reentrar) =====
socket.on('voice-signal', async ({ from, data, username: uname }) => {
  if (!peers[from]) {
    peerUsernames[from] = uname;
    setTileInfo(from, uname, false);
    createPeerConnection(from, false);
  }
  const pc = peers[from];

  if (data && (data.type === 'offer' || data.type === 'answer')) {
    const offerCollision = data.type === 'offer' && (pc._makingOffer || pc.signalingState !== 'stable');
    pc._ignoreOffer = !pc._polite && offerCollision;
    if (pc._ignoreOffer) return;

    if (offerCollision) {
      await Promise.all([
        pc.setLocalDescription({ type: 'rollback' }),
        pc.setRemoteDescription(data)
      ]);
    } else {
      await pc.setRemoteDescription(data);
    }

    if (data.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('voice-signal', { to: from, data: pc.localDescription });
    }
  } else if (data && data.candidate !== undefined) {
    try {
      await pc.addIceCandidate(data);
    } catch (e) {
      if (!pc._ignoreOffer) console.error('erro ao adicionar ICE candidate', e);
    }
  }
});

function createPeerConnection(peerId, isInitiator) {
  const pc = new RTCPeerConnection(ICE_SERVERS);
  peers[peerId] = pc;
  peerStreams[peerId] = new MediaStream();

  // "polite" = quem NÃO iniciou a conexão. Resolve conflitos de renegociação simultânea
  // (isso é o que corrige o bug de tela sumida ao sair/voltar da call).
  pc._polite = !isInitiator;
  pc._makingOffer = false;
  pc._ignoreOffer = false;

  if (micTrack) pc.addTrack(micTrack, micStream || new MediaStream());
  if (activeVideoTrack) pc.addTrack(activeVideoTrack);

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('voice-signal', { to: peerId, data: e.candidate });
  };

  pc.onnegotiationneeded = async () => {
    try {
      pc._makingOffer = true;
      const offer = await pc.createOffer();
      if (pc.signalingState !== 'stable') return;
      await pc.setLocalDescription(offer);
      socket.emit('voice-signal', { to: peerId, data: pc.localDescription });
    } catch (err) {
      console.error('erro de negociação', err);
    } finally {
      pc._makingOffer = false;
    }
  };

  pc.ontrack = (e) => {
    const stream = peerStreams[peerId];
    stream.addTrack(e.track);
    const tile = ensureTile(peerId);
    const video = tile.querySelector('video');
    video.srcObject = stream;
    if (e.track.kind === 'video') setTileHasVideo(peerId, true);
  };

  return pc;
}

function leaveVoice() {
  if (!currentChannelId) return;
  socket.emit('leave-voice', currentChannelId);
  Object.keys(peers).forEach(id => { peers[id].close(); delete peers[id]; });
  Object.keys(peerStreams).forEach(id => delete peerStreams[id]);
  Object.keys(peerUsernames).forEach(id => delete peerUsernames[id]);
  videoGrid.innerHTML = '';

  if (micStream) micStream.getTracks().forEach(t => t.stop());
  if (camTrack) camTrack.stop();
  if (screenTrack) screenTrack.stop();

  micStream = null; micTrack = null; camTrack = null; screenTrack = null;
  activeVideoTrack = null; camOn = false; isScreenSharing = false;
  resetControlButtons();
}

function resetControlButtons() {
  document.getElementById('toggleCamBtn').classList.remove('active');
  document.getElementById('toggleScreenBtn').classList.remove('active');
}

document.getElementById('leaveVoiceBtn').addEventListener('click', () => {
  leaveVoice();
  textView.classList.remove('hidden');
  voiceView.classList.add('hidden');
  currentChannelId = null;
  currentChannelType = null;
  currentChannelNameEl.textContent = 'Bem-vindo ao Wancord';
  renderChannelList();
});

// ===== MUDO (microfone) =====
document.getElementById('toggleMicBtn').addEventListener('click', (e) => {
  if (!micTrack) return;
  micOn = !micOn;
  micTrack.enabled = micOn;
  e.target.classList.toggle('active', micOn);
  e.target.textContent = micOn ? '🎤 Mic' : '🔇 Mudo';
});

// ===== DESATIVAR SOM (deafen) - silencia o que você OUVE, e também muta seu mic (igual Discord) =====
document.getElementById('toggleDeafenBtn').addEventListener('click', (e) => {
  deafened = !deafened;
  e.target.classList.toggle('deafened', deafened);
  e.target.textContent = deafened ? '🔇 Sem som' : '🔊 Som';

  // muta/desmuta o áudio de todo mundo, menos o seu próprio tile
  Object.keys(peerStreams).forEach(id => {
    const tile = document.getElementById('tile-' + id);
    if (tile) tile.querySelector('video').muted = deafened;
  });

  if (deafened && micTrack) {
    // desativar som também desliga seu microfone, igual no Discord
    micOn = false;
    micTrack.enabled = false;
    const micBtn = document.getElementById('toggleMicBtn');
    micBtn.classList.remove('active');
    micBtn.textContent = '🔇 Mudo';
  }
});

// ===== CÂMERA =====
document.getElementById('toggleCamBtn').addEventListener('click', async (e) => {
  if (!camOn) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      camTrack = stream.getVideoTracks()[0];
      await setActiveVideoTrack(camTrack, 'camera');
      camOn = true;
      e.target.classList.add('active');
    } catch (err) {
      alert('Não foi possível acessar a câmera: ' + err.message);
    }
  } else {
    camTrack.stop();
    camTrack = null;
    camOn = false;
    e.target.classList.remove('active');
    // se não estiver compartilhando tela, remove o vídeo enviado
    if (!isScreenSharing) await setActiveVideoTrack(null, 'none');
  }
});

// ===== COMPARTILHAR TELA =====
document.getElementById('toggleScreenBtn').addEventListener('click', async (e) => {
  if (!isScreenSharing) {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenTrack = stream.getVideoTracks()[0];
      await setActiveVideoTrack(screenTrack, 'screen');
      isScreenSharing = true;
      e.target.classList.add('active');
      screenTrack.onended = () => stopScreenShare(e.target);
    } catch (err) {
      // usuário cancelou o seletor de tela, sem problema
    }
  } else {
    stopScreenShare(e.target);
  }
});

function stopScreenShare(btn) {
  if (screenTrack) screenTrack.stop();
  screenTrack = null;
  isScreenSharing = false;
  btn.classList.remove('active');
  // volta pra câmera se estiver ligada, senão fica sem vídeo
  if (camOn && camTrack) {
    setActiveVideoTrack(camTrack, 'camera');
  } else {
    setActiveVideoTrack(null, 'none');
  }
}

// centraliza a troca da track de vídeo enviada (câmera <-> tela <-> nenhuma)
// e propaga corretamente pra conexões já existentes E futuras (era aqui que estava o bug).
async function setActiveVideoTrack(track, kind) {
  const previousTrack = activeVideoTrack;
  activeVideoTrack = track;

  for (const peerId of Object.keys(peers)) {
    const pc = peers[peerId];
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) {
      await sender.replaceTrack(track);
    } else if (track) {
      pc.addTrack(track); // dispara onnegotiationneeded automaticamente
    }
  }

  // atualiza a própria prévia local
  const localTile = document.getElementById('tile-local');
  if (localTile) {
    const video = localTile.querySelector('video');
    if (track) {
      const localPreview = new MediaStream([track]);
      video.srcObject = localPreview;
      localTile.classList.add('has-video');
    } else {
      video.srcObject = null;
      localTile.classList.remove('has-video');
    }
    localTile.classList.toggle('sharing-screen', kind === 'screen');
  }

  if (currentChannelId) {
    socket.emit('video-status', { channelId: currentChannelId, hasVideo: !!track, kind });
  }
}

window.addEventListener('beforeunload', () => { if (currentChannelType === 'voice') leaveVoice(); });
