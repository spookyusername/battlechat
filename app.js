// app.js - Enhanced with Firebase, WebRTC, Queue, Voting, Timer

let currentUser = null;
let currentUserId = null;
let localStream = null;
let inQueue = false;
let currentBattleId = null;
let myRole = null; // 'p1', 'p2', or 'viewer'
let peerConnections = {}; // {otherUserId: RTCPeerConnection}
let p1UserId = null;
let p2UserId = null;
let streak = {p1: 0, p2: 0}; // Update from DB

// DOM Elements (updated video IDs)
const overlay = document.getElementById('username-overlay');
const appContainer = document.getElementById('app-container');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const queueBtn = document.getElementById('queue-btn');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');
const p1Video = document.getElementById('p1Video');
const p2Video = document.getElementById('p2Video');
const p1Username = document.getElementById('p1-username');
const p2Username = document.getElementById('p2-username');
const p1Streak = document.getElementById('p1-streak');
const p2Streak = document.getElementById('p2-streak');
const battleStatus = document.getElementById('battle-status');
const timerEl = document.getElementById('timer');
const voteP1Btn = document.getElementById('vote-p1');
const voteP2Btn = document.getElementById('vote-p2');

// Firebase Config - Paste your config here
const firebaseConfig = {
  apiKey: "AIzaSyDwudK0Z8VPQh4okgzAXBpq1BQJwRqiDTI",
  authDomain: "battlechat-e988c.firebaseapp.com",
  databaseURL: "https://battlechat-e988c-default-rtdb.firebaseio.com",
  projectId: "battlechat-e988c",
  storageBucket: "battlechat-e988c.firebasestorage.app",
  messagingSenderId: "57130292781",
  appId: "1:57130292781:web:586bcfc01bca236e820aa4"
};

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

// STUN/TURN Servers (add your TURN if needed)
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // Add TURN: { urls: 'turn:your.turn.server:3478', username: 'user', credential: 'pass' }
  ]
};

// Init
joinBtn.addEventListener('click', enterApp);
usernameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') enterApp();
});

async function enterApp() {
  const username = usernameInput.value.trim();
  if (username.length > 0) {
    currentUser = username;
    overlay.classList.add('hidden');
    appContainer.classList.remove('hidden');

    // Anonymous auth
    const credential = await auth.signInAnonymously();
    currentUserId = credential.user.uid;

    // Save username
    db.ref(`players/${currentUserId}/username`).set(currentUser);

    addMessage('System', `${currentUser} joined the server.`, true);

    // Start camera
    await startLocalVideo();

    // Listen for current battle (auto-join as viewer if exists)
    db.ref('currentBattleId').on('value', (snap) => {
      const battleId = snap.val();
      if (battleId && !currentBattleId) joinBattle(battleId, 'viewer');
    });

    // Sync chat globally (or per battle later)
    syncChat();

  } else {
    alert("Please enter a username.");
  }
}

async function startLocalVideo() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    // Local video now in p1Video or p2Video based on role later
  } catch (err) {
    console.error("Error accessing media devices.", err);
    addMessage('System', 'Camera/Mic access denied or unavailable.', true);
  }
}

// Queue Button
queueBtn.addEventListener('click', async () => {
  if (!inQueue) {
    inQueue = true;
    queueBtn.innerText = "WAITING IN QUEUE...";
    queueBtn.style.backgroundColor = "#555";
    addMessage('System', 'You joined the battle queue.', true);

    // Add to queue
    await db.ref(`queue/${currentUserId}`).set({
      username: currentUser,
      joinedAt: firebase.database.ServerValue.TIMESTAMP
    });

  } else {
    inQueue = false;
    queueBtn.innerText = "JOIN BATTLE CHAT QUEUE";
    queueBtn.style.backgroundColor = "#8b0000";
    addMessage('System', 'You left the battle queue.', true);

    // Remove from queue
    await db.ref(`queue/${currentUserId}`).remove();
  }
});

// Join battle as fighter or viewer
async function joinBattle(battleId, role = 'viewer') {
  currentBattleId = battleId;
  myRole = role;
  battleStatus.classList.remove('hidden');
  voteP1Btn.classList.toggle('hidden', role !== 'viewer');
  voteP2Btn.classList.toggle('hidden', role !== 'viewer');

  // Get battle data
  const battleRef = db.ref(`battles/${battleId}`);
  battleRef.on('value', (snap) => {
    const data = snap.val();
    if (!data) return;

    p1UserId = data.p1;
    p2UserId = data.p2;
    streak.p1 = data.p1Streak || 0;
    streak.p2 = data.p2Streak || 0;

    // Update UI
    db.ref(`players/${p1UserId}/username`).once('value', (s) => p1Username.innerText = s.val() || 'P1');
    db.ref(`players/${p2UserId}/username`).once('value', (s) => p2Username.innerText = s.val() || 'P2');
    p1Streak.innerText = streak.p1;
    p2Streak.innerText = streak.p2;
    p1Stats.classList.remove('hidden');
    p2Stats.classList.remove('hidden');

    // Start timer
    startTimer(data.endTime);

    // Update votes
    updateVotes(data.votes || {});
  });

  // Get other participants
  battleRef.child('participants').on('value', (snap) => {
    const participants = snap.val() || {};
    Object.keys(participants).forEach(otherId => {
      if (otherId !== currentUserId && !peerConnections[otherId]) {
        createPeerConnection(otherId, battleId);
      }
    });
  });

  // Add self to participants
  await battleRef.child(`participants/${currentUserId}`).set(myRole);

  // Sync chat to this battle
  syncChat(battleId);

  // If fighter, add stream to connections
  if (myRole === 'p1' || myRole === 'p2') {
    p1Video.srcObject = localStream; // Local always left for self if p1, but adjust
  }

  // Vote buttons (viewers only)
  voteP1Btn.addEventListener('click', () => castVote(1));
  voteP2Btn.addEventListener('click', () => castVote(2));
}

// Create P2P connection to another user
function createPeerConnection(otherId, battleId) {
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[otherId] = pc;

  // Add local stream if fighter
  if (myRole !== 'viewer' && localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  // Receive remote stream
  pc.ontrack = (event) => {
    const stream = event.streams[0];
    // Assign to p1 or p2 video based on otherId
    if (otherId === p1UserId) p1Video.srcObject = stream;
    else if (otherId === p2UserId) p2Video.srcObject = stream;
  };

  // ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      db.ref(`signaling/${battleId}/${currentUserId}-${otherId}/ice`).push(event.candidate.toJSON());
    }
  };

  // Listen for remote ICE
  db.ref(`signaling/${battleId}/${otherId}-${currentUserId}/ice`).on('child_added', async (snap) => {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(snap.val()));
    } catch (err) { console.error(err); }
  });

  // Signaling: If my ID < other ID, create offer (to avoid duplicates)
  if (currentUserId < otherId) {
    createOffer(pc, battleId, otherId);
  } else {
    // Listen for offer
    db.ref(`signaling/${battleId}/${otherId}-${currentUserId}/offer`).on('value', async (snap) => {
      const offer = snap.val();
      if (offer) {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        db.ref(`signaling/${battleId}/${currentUserId}-${otherId}/answer`).set({
          type: answer.type,
          sdp: answer.sdp
        });
      }
    });
  }

  // Listen for answer
  db.ref(`signaling/${battleId}/${otherId}-${currentUserId}/answer`).on('value', async (snap) => {
    const answer = snap.val();
    if (answer && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  });
}

async function createOffer(pc, battleId, otherId) {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  db.ref(`signaling/${battleId}/${currentUserId}-${otherId}/offer`).set({
    type: offer.type,
    sdp: offer.sdp
  });
}

// Timer
let timerInterval;
function startTimer(endTime) {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const remaining = Math.max(0, (endTime - Date.now()) / 1000);
    const min = Math.floor(remaining / 60);
    const sec = Math.floor(remaining % 60);
    timerEl.innerText = `${min}:${sec < 10 ? '0' : ''}${sec}`;
    if (remaining <= 0) {
      clearInterval(timerInterval);
      addMessage('System', 'Battle ended!', true);
      // Client-side cleanup; function handles logic
    }
  }, 1000);
}

// Voting
async function castVote(player) {
  if (myRole !== 'viewer') return alert('Only viewers can vote!');
  await db.ref(`battles/${currentBattleId}/votes/${currentUserId}`).set(player);
  addMessage('System', `You voted for P${player}.`, true);
}

function updateVotes(votes) {
  let p1Count = 0, p2Count = 0;
  Object.values(votes).forEach(v => v === 1 ? p1Count++ : p2Count++);
  // Update UI if needed (e.g., percentage bars - add CSS/JS for that)
  db.ref(`battles/${currentBattleId}`).update({votesP1: p1Count, votesP2: p2Count});
}

// Chat Sync
function syncChat(battleId = null) {
  const chatRef = db.ref(battleId ? `chat/${battleId}` : 'chat/global');
  chatRef.on('child_added', (snap) => {
    const msg = snap.val();
    addMessage(msg.user, msg.text, msg.isSystem);
  });

  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const msg = chatInput.value.trim();
      if (msg) {
        chatRef.push({
          user: currentUser,
          text: msg,
          isSystem: false,
          time: firebase.database.ServerValue.TIMESTAMP
        });
        chatInput.value = '';
      }
    }
  });
}

function addMessage(user, text, isSystem) {
  const msgDiv = document.createElement('div');
  msgDiv.classList.add('message');
  if (isSystem) {
    msgDiv.classList.add('system');
    msgDiv.innerText = text;
  } else {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    msgDiv.innerHTML = `<span class="msg-username">${user}:</span><span class="msg-text">${text}</span><span class="msg-time">${time}</span>`;
  }
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
