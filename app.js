// app.js - Single streamer queue + session-only chat history

let currentUser = null;
let currentUserId = null;
let localStream = null;
let inQueue = false;
let currentLiveId = null;
let myRole = null; // 'streamer' or 'viewer'
let peerConnections = {};
let streamerUserId = null;

// DOM Elements
const streamerUsername = document.getElementById('streamer-username');
const streamerVideo = document.getElementById('streamerVideo');
const queueBtn = document.getElementById('queue-btn');
const overlay = document.getElementById('username-overlay');
const appContainer = document.getElementById('app-container');
const joinBtn = document.getElementById('join-btn');
const usernameInput = document.getElementById('username-input');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const timer = document.getElementById('timer');

// ... (keep rtcConfig and other init, adjust for single peer)

// Init listeners
joinBtn.addEventListener('click', enterApp);
usernameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') enterApp();
});

async function enterApp() {
  const username = usernameInput.value.trim();
  if (username.length === 0) {
    alert("Enter username");
    return;
  }

  try {
    currentUser = username;

    const credential = await firebaseSignInAnonymously(firebaseAuth);
    currentUserId = credential.user.uid;

    await firebaseSet(firebaseRef(firebaseDb, `players/${currentUserId}/username`), currentUser);

    overlay.classList.add('hidden');
    appContainer.classList.remove('hidden');

    addMessage('System', `${currentUser} joined. Click JOIN QUEUE to go live.`, true);

    syncChat(); // Moved here for joinTime

    firebaseOnValue(firebaseRef(firebaseDb, 'currentLiveId'), (snap) => {
      const liveId = snap.val();
      if (liveId && liveId !== currentLiveId) {
        joinStream(liveId, 'viewer');
      } else if (!liveId && currentLiveId) {
        leaveStream();
      }
    });

    // Listener to promote from queue if no live
    firebaseOnValue(firebaseRef(firebaseDb, 'queue'), promoteFromQueue);

  } catch (error) {
    console.error("Join error:", error);
    alert("Error: " + error.message);
  }
}

// Queue button - starts camera + adds to queue or becomes live
queueBtn.addEventListener('click', async () => {
  if (!currentUserId) {
    alert("Join first (enter username)");
    return;
  }

  if (!inQueue && myRole !== 'streamer') {
    // Request camera/microphone
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      addMessage('System', 'Camera & mic enabled.', true);
    } catch (err) {
      console.error("Permission denied:", err);
      alert("Camera/mic access denied.");
      return;
    }

    // Check if can become live immediately
    const liveSnap = await firebaseGet(firebaseRef(firebaseDb, 'currentLiveId'));
    if (!liveSnap.exists()) {
      becomeStreamer();
    } else {
      joinQueue();
    }

  } else {
    // Leave
    if (myRole === 'streamer') {
      endStream();
    } else if (inQueue) {
      leaveQueue();
    }
  }
});

async function joinQueue() {
  inQueue = true;
  queueBtn.innerText = "WAITING IN QUEUE...";
  queueBtn.style.backgroundColor = "#555";

  await firebaseSet(firebaseRef(firebaseDb, `queue/${currentUserId}`), {
    username: currentUser,
    joinedAt: firebaseServerTimestamp()
  });

  addMessage('System', 'In queue.', true);
}

async function leaveQueue() {
  inQueue = false;
  queueBtn.innerText = "JOIN QUEUE TO GO LIVE";
  queueBtn.style.backgroundColor = "#8b0000";

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  await firebaseRemove(firebaseRef(firebaseDb, `queue/${currentUserId}`));
  addMessage('System', 'Left queue.', true);
}

async function becomeStreamer() {
  myRole = 'streamer';
  currentLiveId = currentUserId;
  queueBtn.innerText = "END STREAM";
  queueBtn.style.backgroundColor = "#d11111";

  await firebaseSet(firebaseRef(firebaseDb, 'currentLiveId'), currentUserId);

  joinStream(currentUserId, 'streamer');
  addMessage('System', 'You are live!', true);
}

async function endStream() {
  myRole = null;
  await firebaseRemove(firebaseRef(firebaseDb, 'currentLiveId'));

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  leaveStream();
  queueBtn.innerText = "JOIN QUEUE TO GO LIVE";
  queueBtn.style.backgroundColor = "#8b0000";
  addMessage('System', 'Stream ended.', true);
}

async function promoteFromQueue(snap) {
  if (!snap.exists() || myRole === 'streamer') return;

  const queueData = snap.val();
  const sorted = Object.entries(queueData).sort((a, b) => a[1].joinedAt.seconds - b[1].joinedAt.seconds);
  const nextId = sorted[0][0];

  if (nextId !== currentUserId) return;

  const liveSnap = await firebaseGet(firebaseRef(firebaseDb, 'currentLiveId'));
  if (!liveSnap.exists()) {
    await firebaseRemove(firebaseRef(firebaseDb, `queue/${currentUserId}`));
    becomeStreamer();
  }
}

function joinStream(liveId, role) {
  currentLiveId = liveId;
  myRole = role;
  streamerUserId = liveId;

  // Get username
  firebaseOnValue(firebaseRef(firebaseDb, `players/${streamerUserId}/username`), (snap) => {
    streamerUsername.innerText = snap.val() || 'ANONYMOUS';
  });

  if (role === 'streamer') {
    streamerVideo.srcObject = localStream;
    timer.innerText = 'LIVE';
    // Handle incoming viewer connections via signaling
  } else {
    // Viewer: create peer connection to streamer
    createPeerConnection(streamerUserId);
    // Signaling to get stream
  }

  // ... (adjust createPeerConnection, signaling for single streamer-viewers)
}

function leaveStream() {
  currentLiveId = null;
  myRole = null;
  streamerUserId = null;
  streamerUsername.innerText = 'WAITING...';
  streamerVideo.srcObject = null;
  timer.innerText = 'OFFLINE';
  Object.values(peerConnections).forEach(pc => pc.close());
  peerConnections = {};
}

// Assume addMessage function exists
function addMessage(sender, text, isSystem = false, timestamp = null) {
  const msgDiv = document.createElement('div');
  msgDiv.classList.add('message');
  if (isSystem) msgDiv.classList.add('system');

  const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();

  msgDiv.innerHTML = `
    <span class="msg-username">${sender}:</span>
    <span class="msg-text">${text}</span>
    <span class="msg-time">(${timeStr})</span>
  `;
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Chat input listener (assume exists, add timestamp)
chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    const text = chatInput.value.trim();
    if (text) {
      firebasePush(firebaseRef(firebaseDb, 'chat'), {
        user: currentUser,
        text: text,
        time: firebaseServerTimestamp()
      });
      chatInput.value = '';
    }
  }
});

// Session-only chat: only new messages after join
let joinTime; // Set in enterApp before syncChat
joinTime = Date.now(); // Approx client time

function syncChat() {
  const messagesRef = firebaseRef(firebaseDb, 'chat');
  const recentQuery = firebaseQuery(messagesRef, firebaseOrderByChild('time'), firebaseStartAt(joinTime));
  firebaseOnChildAdded(recentQuery, (snap) => {
    const msg = snap.val();
    addMessage(msg.user, msg.text, false, msg.time);
  });
}

// ... (keep other functions, remove battle/vote/timer/streak logic)
</DOCUMENT>

