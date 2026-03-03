// app.js - Wrapped in DOMContentLoaded so elements exist before attaching listeners

document.addEventListener('DOMContentLoaded', () => {
  console.log("Page fully loaded - attaching event listeners now");

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
  const p1Stats = document.getElementById('p1-stats');
  const p2Stats = document.getElementById('p2-stats');
  const battleStatus = document.getElementById('battle-status');
  const timerEl = document.getElementById('timer');
  const voteP1Btn = document.getElementById('vote-p1');
  const voteP2Btn = document.getElementById('vote-p2');

  // STUN/TURN Servers
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
    ]
  };

  // Attach listeners
  joinBtn.addEventListener('click', enterApp);
  usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') enterApp();
  });

  // Queue button
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

  // Your enterApp function
  async function enterApp() {
    console.log("JOIN clicked - starting enterApp"); // Debug log

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

  // ... keep all your other functions here: startLocalVideo (if you still have it), forceStartBattleForTesting, joinBattle, createPeerConnection, createOffer, startTimer, castVote, updateVotes, syncChat, addMessage
  // (copy them from your current app.js if missing - just make sure they are inside this DOMContentLoaded block)

  console.log("All listeners attached");
});
