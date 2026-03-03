// app.js - Global chat + solo preview + test visibility

document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM ready – app starting");

  // VARIABLES
  let currentUser = null;
  let currentUserId = null;
  let localStream = null;
  let inQueue = false;
  let currentBattleId = null;
  let myRole = null;
  let peerConnections = {};
  let p1UserId = null;
  let p2UserId = null;
  let streak = { p1: 0, p2: 0 };
  let lastChatKeys = new Set();

  // DOM
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

  const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  // ────────────────────────────────────────────────
  // HELPER FUNCTIONS
  // ────────────────────────────────────────────────

  function addMessage(user, text, isSystem = false) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message');
    if (isSystem) {
      msgDiv.classList.add('system');
      msgDiv.textContent = text;
    } else {
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      msgDiv.innerHTML = `
        <span class="msg-username">${user}:</span>
        <span class="msg-text">${text}</span>
        <span class="msg-time">${time}</span>
      `;
    }
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function enterSoloPreviewMode() {
    console.log("Entering solo preview mode");
    const videoGrid = document.querySelector('.video-grid');
    videoGrid.classList.add('solo-preview');

    p1Video.srcObject = localStream;
    p1Video.muted = true;
    p1Video.play().catch(e => console.error("Preview play error:", e));

    p1Username.innerText = currentUser || "WAITING FOR OPPONENT";
    p1Streak.innerText = "0";
    p1Stats.classList.remove('hidden');

    addMessage('System', 'Waiting for someone to join... Your preview is live!', true);
  }

  function exitSoloPreviewMode() {
    console.log("Exiting solo preview mode");
    const videoGrid = document.querySelector('.video-grid');
    videoGrid.classList.remove('solo-preview');

    p1Video.srcObject = null;
    p2Video.srcObject = null;
  }

  // ────────────────────────────────────────────────
  // JOIN
  // ────────────────────────────────────────────────
  async function enterApp() {
    const username = usernameInput.value.trim();
    if (!username) return alert("Enter username");

    try {
      currentUser = username;
      const credential = await firebaseSignInAnonymously(firebaseAuth);
      currentUserId = credential.user.uid;

      await firebaseSet(firebaseRef(firebaseDb, `players/${currentUserId}/username`), currentUser);

      overlay.classList.add('hidden');
      appContainer.classList.remove('hidden');

      addMessage('System', `${currentUser} joined the chat.`, true);

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

  // ────────────────────────────────────────────────
  // GLOBAL CHAT
  // ────────────────────────────────────────────────
  function syncChat() {
    const chatRef = firebaseRef(firebaseDb, 'chat/global');

    chatMessages.innerHTML = '';
    lastChatKeys.clear();

    firebaseOnValue(chatRef, (snap) => {
      const messages = snap.val() || {};
      Object.entries(messages).forEach(([key, msg]) => {
        if (!lastChatKeys.has(key)) {
          addMessage(msg.user || 'Anonymous', msg.text || '[empty]', msg.isSystem || false);
          lastChatKeys.add(key);
        }
      });
    });

    chatInput.addEventListener('keypress', async (e) => {
      if (e.key === 'Enter') {
        const text = chatInput.value.trim();
        if (text && currentUser) {
          await firebasePush(chatRef, {
            user: currentUser,
            text: text,
            isSystem: false,
            time: firebaseServerTimestamp()
          });
          chatInput.value = '';
        }
      }
    });
  }

  // ────────────────────────────────────────────────
  // QUEUE – starts big solo preview
  // ────────────────────────────────────────────────
  queueBtn.addEventListener('click', async () => {
    if (!currentUserId) return alert("Enter username first");

    if (!inQueue) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

        enterSoloPreviewMode();  // ← This makes it big/centered

        inQueue = true;
        queueBtn.innerText = "WAITING IN QUEUE...";
        queueBtn.style.backgroundColor = "#555";

        await firebaseSet(firebaseRef(firebaseDb, `queue/${currentUserId}`), {
          username: currentUser,
          joinedAt: firebaseServerTimestamp()
        });

      } catch (err) {
        alert("Camera error: " + err.message);
      }
    } else {
      inQueue = false;
      queueBtn.innerText = "JOIN BATTLE CHAT QUEUE";
      queueBtn.style.backgroundColor = "#8b0000";

      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
      }

      exitSoloPreviewMode();

      await firebaseRemove(firebaseRef(firebaseDb, `queue/${currentUserId}`));
      addMessage('System', 'Left queue.', true);
    }
  });

  // ────────────────────────────────────────────────
  // DEBUG: Simulate battle so other tabs can see your camera
  // Add this button to index.html sidebar if not there:
  // <button id="test-match-btn" class="action-btn" style="margin-top:10px;background:#006600;">TEST MATCH (SEE MY CAM)</button>
  // ────────────────────────────────────────────────
  const testMatchBtn = document.getElementById('test-match-btn');
  if (testMatchBtn) {
    testMatchBtn.addEventListener('click', async () => {
      if (!currentUserId || !localStream) {
        alert("Queue first to start camera");
        return;
      }

      const testId = 'test-' + Date.now();
      await firebaseSet(firebaseRef(firebaseDb, 'currentBattleId'), testId);

      await firebaseSet(firebaseRef(firebaseDb, `battles/${testId}`), {
        p1: currentUserId,
        p2: null, // simulate waiting for p2
        startTime: firebaseServerTimestamp(),
        endTime: Date.now() + 120000,
        votesP1: 0,
        votesP2: 0
      });

      await firebaseSet(firebaseRef(firebaseDb, `battles/${testId}/participants/${currentUserId}`), 'p1');

      addMessage('System', 'Test match started — your camera is now live. Open another tab to join and see it!', true);
    });
  }

  // Attach JOIN
  joinBtn.addEventListener('click', enterApp);
  usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') enterApp();
  });

  console.log("App ready");
});
