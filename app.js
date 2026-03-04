// app.js

let currentUser = null;
let currentUserId = null;
let localStream = null;
let inQueue = false;
let currentBattleId = null;
let myRole = null; // 'p1', 'p2', or 'viewer'
let peerConnections = {};
let p1UserId = null;
let p2UserId = null;
let streak = {p1: 0, p2: 0};

// DOM Elements
const overlay          = document.getElementById('username-overlay');
const appContainer     = document.getElementById('app-container');
const usernameInput    = document.getElementById('username-input');
const joinBtn          = document.getElementById('join-btn');
const queueBtn         = document.getElementById('queue-btn');
const chatMessages     = document.getElementById('chat-messages');
const chatInput        = document.getElementById('chat-input');
const p1Video          = document.getElementById('p1Video');
const p2Video          = document.getElementById('p2Video');
const p1Username       = document.getElementById('p1-username');
const p2Username       = document.getElementById('p2-username');
const timerEl          = document.getElementById('timer');
const battleStatus     = document.getElementById('battle-status');
const voteP1           = document.getElementById('vote-p1');
const voteP2           = document.getElementById('vote-p2');

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

    addMessage('System', `${currentUser} joined. Click JOIN QUEUE to start camera and queue up.`, true);

    firebaseOnValue(firebaseRef(firebaseDb, 'currentBattleId'), (snap) => {
      const battleId = snap.val();
      if (battleId && !currentBattleId) joinBattle(battleId, 'viewer');
    });

    syncChat();

  } catch (error) {
    console.error("Join error:", error);
    alert("Error: " + error.message);
  }
}

queueBtn.addEventListener('click', async () => {
  if (!currentUserId) {
    alert("Join first (enter username)");
    return;
  }

  if (!inQueue) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      addMessage('System', 'Camera & mic enabled. You are now queueing.', true);
    } catch (err) {
      console.error("Permission denied:", err);
      alert("Camera/mic access denied. You can't queue without it.");
      return;
    }

    inQueue = true;
    queueBtn.innerText = "WAITING IN QUEUE...";
    queueBtn.style.backgroundColor = "#555";

    await firebaseSet(firebaseRef(firebaseDb, `queue/${currentUserId}`), {
      username: currentUser,
      joinedAt: firebaseServerTimestamp()
    });

  } else {
    inQueue = false;
    queueBtn.innerText = "JOIN BATTLE CHAT QUEUE";
    queueBtn.style.backgroundColor = "#8b0000";

    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }

    await firebaseRemove(firebaseRef(firebaseDb, `queue/${currentUserId}`));
    addMessage('System', 'Left queue. Camera stopped.', true);
  }
});

// Placeholder functions (add your real logic later)
function addMessage(sender, text, isSystem = false) {
  const div = document.createElement('div');
  div.className = `message ${isSystem ? 'system' : ''}`;
  div.innerHTML = isSystem ? text : `<span class="msg-username">${sender}</span><span class="msg-text">${text}</span>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function syncChat() {
  // TODO: real chat listener
}

function joinBattle(battleId, role) {
  // TODO: real battle join logic
  console.log(`Joined battle ${battleId} as ${role}`);
}
