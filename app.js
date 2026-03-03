document.addEventListener('DOMContentLoaded', () => {
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

  const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  function addMessage(user, text, isSystem = false) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message');
    if (isSystem) msgDiv.classList.add('system'), msgDiv.textContent = text;
    else {
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      msgDiv.innerHTML = `<span class="msg-username">${user}:</span><span class="msg-text">${text}</span><span class="msg-time">${time}</span>`;
    }
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function enterSoloPreviewMode() {
    document.querySelector('.video-grid').classList.add('solo-preview');
    p1Video.srcObject = localStream;
    p1Video.muted = true;
    p1Video.play().catch(() => {});
    p1Username.innerText = currentUser || "WAITING FOR OPPONENT";
    p1Streak.innerText = "0";
    p1Stats.classList.remove('hidden');
    addMessage('System', 'Waiting for opponent... Your preview is live!', true);
  }

  function exitSoloPreviewMode() {
    document.querySelector('.video-grid').classList.remove('solo-preview');
  }

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
      alert("Error: " + error.message);
    }
  }

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
          await firebasePush(chatRef, { user: currentUser, text, isSystem: false, time: firebaseServerTimestamp() });
          chatInput.value = '';
        }
      }
    });
  }

  queueBtn.addEventListener('click', async () => {
    if (!currentUserId) return alert("Enter username first");

    if (!inQueue) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        enterSoloPreviewMode();

        inQueue = true;
        queueBtn.innerText = "WAITING IN QUEUE...";
        queueBtn.style.backgroundColor = "#555";

        await firebaseSet(firebaseRef(firebaseDb, `queue/${currentUserId}`), {
          username: currentUser,
          joinedAt: firebaseServerTimestamp()
        });

        // Auto-pair check
        const queueSnap = await firebaseGet(firebaseRef(firebaseDb, 'queue'));
        const queueData = queueSnap.val() || {};
        const queuedUsers = Object.keys(queueData).filter(id => id !== currentUserId);

        if (queuedUsers.length >= 1) {
          const opponentId = queuedUsers[0];
          const battleId = 'battle-' + Date.now();

          await firebaseSet(firebaseRef(firebaseDb, 'currentBattleId'), battleId);

          await firebaseSet(firebaseRef(firebaseDb, `battles/${battleId}`), {
            p1: currentUserId,
            p2: opponentId,
            startTime: firebaseServerTimestamp(),
            endTime: Date.now() + 120000,
            votesP1: 0,
            votesP2: 0
          });

          await firebaseSet(firebaseRef(firebaseDb, `battles/${battleId}/participants/${currentUserId}`), 'p1');
          await firebaseSet(firebaseRef(firebaseDb, `battles/${battleId}/participants/${opponentId}`), 'p2');

          await firebaseRemove(firebaseRef(firebaseDb, `queue/${currentUserId}`));
          await firebaseRemove(firebaseRef(firebaseDb, `queue/${opponentId}`));

          addMessage('System', `Match found! Battling ${queueData[opponentId].username}...`, true);
          exitSoloPreviewMode();
        }
      } catch (err) {
        alert("Camera error: " + err.message);
      }
    } else {
      inQueue = false;
      queueBtn.innerText = "JOIN BATTLE CHAT QUEUE";
      queueBtn.style.backgroundColor = "#8b0000";

      if (localStream) localStream.getTracks().forEach(track => track.stop());
      localStream = null;

      exitSoloPreviewMode();

      await firebaseRemove(firebaseRef(firebaseDb, `queue/${currentUserId}`));
      addMessage('System', 'Left queue.', true);
    }
  });

  joinBtn.addEventListener('click', enterApp);
  usernameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') enterApp(); });

  console.log("App ready");
});
