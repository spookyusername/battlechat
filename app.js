// app.js - Updated to Firebase modular style (using globals from index.html module script)

let currentUser = null;
let currentUserId = null;
let localStream = null;
let inQueue = false;
let currentBattleId = null;
let myRole = null; // 'p1', 'p2', or 'viewer'
let peerConnections = {}; // {otherUserId: RTCPeerConnection}
let p1UserId = null;
let p2UserId = null;
let streak = {p1: 0, p2: 0};

// DOM Elements
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
const p1Stats = document.getElementById('p1-stats');   // Added - was missing
const p2Stats = document.getElementById('p2-stats');   // Added - was missing
const battleStatus = document.getElementById('battle-status');
const timerEl = document.getElementById('timer');
const voteP1Btn = document.getElementById('vote-p1');
const voteP2Btn = document.getElementById('vote-p2');

// STUN/TURN Servers
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // Add TURN here later if connections fail
  ]
};

// Init event listeners
joinBtn.addEventListener('click', enterApp);
usernameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') enterApp();
});

async function enterApp() {
  const username = usernameInput.value.trim();
  if (username.length === 0) {
    alert("Please enter a username.");
    return;
  }

  try {
    currentUser = username;

    // Anonymous sign-in using modular auth
    const credential = await firebaseSignInAnonymously(firebaseAuth);
    currentUserId = credential.user.uid;

    // Hide overlay and show app
    overlay.classList.add('hidden');
    appContainer.classList.remove('hidden');

    // Save username to DB
    await firebaseSet(firebaseRef(firebaseDb, `players/${currentUserId}/username`), currentUser);

    addMessage('System', `${currentUser} joined the server.`, true);

    // Start local camera
    await startLocalVideo();

    // Listen for active battle (auto-join as viewer)
    firebaseOnValue(firebaseRef(firebaseDb, 'currentBattleId'), (snap) => {
      const battleId = snap.val();
      if (battleId && !currentBattleId) {
        joinBattle(battleId, 'viewer');
      }
    });

    // Start global chat sync (can change to battle-specific later)
    syncChat();

  } catch (error) {
    console.error("Join failed:", error);
    alert("Error joining: " + (error.message || "Unknown error. Check console (F12)."));
  }
}

async function startLocalVideo() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    // We'll assign it to video element based on role later
  } catch (err) {
    console.error("Media error:", err);
    addMessage('System', 'Camera/Mic access denied or unavailable.', true);
  }
}

// Queue toggle
queueBtn.addEventListener('click', async () => {
  if (!inQueue) {
    inQueue = true;
    queueBtn.innerText = "WAITING IN QUEUE...";
    queueBtn.style.backgroundColor = "#555";
    addMessage('System', 'You joined the battle queue.', true);

    await firebaseSet(firebaseRef(firebaseDb, `queue/${currentUserId}`), {
      username: currentUser,
      joinedAt: firebaseServerTimestamp()
    });
  } else {
    inQueue = false;
    queueBtn.innerText = "JOIN BATTLE CHAT QUEUE";
    queueBtn.style.backgroundColor = "#8b0000";
    addMessage('System', 'You left the battle queue.', true);

    await firebaseRemove(firebaseRef(firebaseDb, `queue/${currentUserId}`));
  }
});

// Join a battle (fighter or viewer)
async function joinBattle(battleId, role = 'viewer') {
  currentBattleId = battleId;
  myRole = role;
  battleStatus.classList.remove('hidden');
  voteP1Btn.classList.toggle('hidden', role !== 'viewer');
  voteP2Btn.classList.toggle('hidden', role !== 'viewer');

  const battleRef = firebaseRef(firebaseDb, `battles/${battleId}`);

  // Listen for battle changes
  firebaseOnValue(battleRef, (snap) => {
    const data = snap.val();
    if (!data) return;

    p1UserId = data.p1;
    p2UserId = data.p2;
    streak.p1 = data.p1Streak || 0;
    streak.p2 = data.p2Streak || 0;

    // Fetch usernames
    firebaseOnValue(firebaseRef(firebaseDb, `players/${p1UserId}/username`), (s) => {
      p1Username.innerText = s.val() || 'P1';
    });
    firebaseOnValue(firebaseRef(firebaseDb, `players/${p2UserId}/username`), (s) => {
      p2Username.innerText = s.val() || 'P2';
    });

    p1Streak.innerText = streak.p1;
    p2Streak.innerText = streak.p2;
    p1Stats.classList.remove('hidden');
    p2Stats.classList.remove('hidden');

    startTimer(data.endTime || Date.now() + 120000); // Fallback
    updateVotes(data.votes || {});
  });

  // Participants for WebRTC
  firebaseOnValue(firebaseRef(battleRef, 'participants'), (snap) => {
    const participants = snap.val() || {};
    Object.keys(participants).forEach(otherId => {
      if (otherId !== currentUserId && !peerConnections[otherId]) {
        createPeerConnection(otherId, battleId);
      }
    });
  });

  // Join participants list
  await firebaseSet(firebaseRef(battleRef, `participants/${currentUserId}`), myRole);

  // Switch chat to battle-specific
  syncChat(battleId);

  // Show local stream if fighter
  if (myRole === 'p1' || myRole === 'p2') {
    if (myRole === 'p1') p1Video.srcObject = localStream;
    if (myRole === 'p2') p2Video.srcObject = localStream;
  }

  // Vote listeners (only once)
  voteP1Btn.onclick = () => castVote(1);
  voteP2Btn.onclick = () => castVote(2);
}

// WebRTC Peer Connection setup (unchanged except DB refs)
function createPeerConnection(otherId, battleId) {
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[otherId] = pc;

  if (myRole !== 'viewer' && localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.ontrack = (event) => {
    const stream = event.streams[0];
    if (otherId === p1UserId) p1Video.srcObject = stream;
    else if (otherId === p2UserId) p2Video.srcObject = stream;
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      firebasePush(firebaseRef(firebaseDb, `signaling/${battleId}/${currentUserId}-${otherId}/ice`), event.candidate.toJSON());
    }
  };

  // Remote ICE
  firebaseOnValue(firebaseRef(firebaseDb, `signaling/${battleId}/${otherId}-${currentUserId}/ice`), async (snap) => {
    snap.forEach(async child => {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(child.val()));
      } catch (err) {
        console.error("ICE add error:", err);
      }
    });
  });

  // Offer/Answer logic (unchanged but using new DB methods)
  if (currentUserId < otherId) {
    createOffer(pc, battleId, otherId);
  } else {
    firebaseOnValue(firebaseRef(firebaseDb, `signaling/${battleId}/${otherId}-${currentUserId}/offer`), async (snap) => {
      const offer = snap.val();
      if (offer) {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await firebaseSet(firebaseRef(firebaseDb, `signaling/${battleId}/${currentUserId}-${otherId}/answer`), {
          type: answer.type,
          sdp: answer.sdp
        });
      }
    });
  }

  firebaseOnValue(firebaseRef(firebaseDb, `signaling/${battleId}/${otherId}-${currentUserId}/answer`), async (snap) => {
    const answer = snap.val();
    if (answer && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  });
}

async function createOffer(pc, battleId, otherId) {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await firebaseSet(firebaseRef(firebaseDb, `signaling/${battleId}/${currentUserId}-${otherId}/offer`), {
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
    }
  }, 1000);
}

// Voting
async function castVote(player) {
  if (myRole !== 'viewer') return alert('Only viewers can vote!');
  await firebaseSet(firebaseRef(firebaseDb, `battles/${currentBattleId}/votes/${currentUserId}`), player);
  addMessage('System', `You voted for P${player}.`, true);
}

function updateVotes(votes) {
  let p1Count = 0, p2Count = 0;
  Object.values(votes).forEach(v => v === 1 ? p1Count++ : p2Count++);
  // Optional: add UI progress bars here later
  firebaseSet(firebaseRef(firebaseDb, `battles/${currentBattleId}`), { votesP1: p1Count, votesP2: p2Count }, { merge: true });
}

// Chat
function syncChat(battleId = null) {
  const path = battleId ? `chat/${battleId}` : 'chat/global';
  const chatRef = firebaseRef(firebaseDb, path);

  firebaseOnValue(chatRef, (snap) => {
    // Clear old messages? Or append only new - for simplicity, reload or use child_added
    // For now: use child_added pattern instead
  });

  // Better: use child_added for incremental
  // But to keep simple, assume you reload or handle in child_added

  // Listener for new messages (replace on('child_added'))
  // Note: onValue is for whole ref, better to use on child_added via separate listener if needed

  // For now keep as is, but change to modular
  // (You can optimize later)

  chatInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      const msg = chatInput.value.trim();
      if (msg) {
        await firebasePush(chatRef, {
          user: currentUser,
          text: msg,
          isSystem: false,
          time: firebaseServerTimestamp()
        });
        chatInput.value = '';
      }
    }
  });
}

// Note: Your original syncChat uses .on('child_added') - to match exactly:
function syncChat(battleId = null) {
  const path = battleId ? `chat/${battleId}` : 'chat/global';
  const chatRef = firebaseRef(firebaseDb, path);

  // Use a separate listener for child_added (Firebase modular has no direct 'on child_added', use onValue and track changes or use limitToLast)
  // For simplicity, here's a basic child_added emulation with onValue + previous snapshot (advanced, but ok for start)
  let lastKeys = new Set();

  firebaseOnValue(chatRef, (snap) => {
    const messages = snap.val() || {};
    Object.keys(messages).forEach(key => {
      if (!lastKeys.has(key)) {
        const msg = messages[key];
        addMessage(msg.user, msg.text, msg.isSystem);
        lastKeys.add(key);
      }
    });
  });

  // Input handler
  chatInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      const msg = chatInput.value.trim();
      if (msg) {
        await firebasePush(chatRef, {
          user: currentUser,
          text: msg,
          isSystem: false,
          time: firebaseServerTimestamp()
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
