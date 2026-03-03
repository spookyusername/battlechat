// app.js - Global chat + solo preview + auto-pair on 2nd queue

document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM ready – starting app");

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

  const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  // ────────────────────────────────────────────────
  // HELPERS
  // ────────────────────────────────────────────────

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
    p1Video.play().catch(e => console.error("Preview play error:", e));
    p1Username.innerText = currentUser || "WAITING FOR OPPONENT";
    p1Streak.innerText = "0";
    p1Stats.classList.remove('hidden');
    addMessage('System', 'Waiting for opponent... Your preview is live!', true);
  }

  function exitSoloPreviewMode() {
    document.querySelector('.video-grid').classList.remove('solo-preview');
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
  // QUEUE – auto-pair if someone else is waiting
  // ────────────────────────────────────────────────
  queueBtn.addEventListener('click', async () => {
    if (!currentUserId) return alert("Enter username first");

    if (!inQueue) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        enterSoloPreviewMode();  // Big preview for solo

        inQueue = true;
        queueBtn.innerText = "WAITING IN QUEUE...";
        queueBtn.style.backgroundColor = "#555";

        await firebaseSet(firebaseRef(firebaseDb, `queue/${currentUserId}`), {
          username: currentUser,
          joinedAt: firebaseServerTimestamp()
        });

        // Check if someone else is in queue (simple 2-player auto-match)
        const queueSnap = await firebaseGet(firebaseRef(firebaseDb, 'queue'));
        const queueData = queueSnap.val() || {};
        const queuedUsers = Object.keys(queueData).filter(id => id !== currentUserId);

        if (queuedUsers.length >= 1) {
          // Found someone — create battle, you as p1, them as p2
          const opponentId = queuedUsers[0]; // first waiting person
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

          // Remove both from queue
          await firebaseRemove(firebaseRef(firebaseDb, `queue/${currentUserId}`));
          await firebaseRemove(firebaseRef(firebaseDb, `queue/${opponentId}`));

          addMessage('System', `Match found! Battling ${queueData[opponentId].username}...`, true);
          exitSoloPreviewMode(); // Switch to split screen
        }

      } catch (err) {
        alert("Camera error: " + err.message);
      }
    } else {
      // Leave queue
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
  // BATTLE (when match starts)
  // ────────────────────────────────────────────────
  async function joinBattle(battleId, role = 'viewer') {
    currentBattleId = battleId;
    myRole = role;
    battleStatus.classList.remove('hidden');
    voteP1Btn.classList.toggle('hidden', role !== 'viewer');
    voteP2Btn.classList.toggle('hidden', role !== 'viewer');

    const battleRef = firebaseRef(firebaseDb, `battles/${battleId}`);

    firebaseOnValue(battleRef, (snap) => {
      const data = snap.val();
      if (!data) return;

      p1UserId = data.p1;
      p2UserId = data.p2;

      firebaseOnValue(firebaseRef(firebaseDb, `players/${p1UserId}/username`), (s) => p1Username.innerText = s.val() || 'P1');
      firebaseOnValue(firebaseRef(firebaseDb, `players/${p2UserId}/username`), (s) => p2Username.innerText = s.val() || 'P2');

      p1Streak.innerText = data.p1Streak || 0;
      p2Streak.innerText = data.p2Streak || 0;
      p1Stats.classList.remove('hidden');
      p2Stats.classList.remove('hidden');

      startTimer(data.endTime || Date.now() + 120000);
      updateVotes(data.votes || {});
    });

    firebaseOnValue(firebaseRef(battleRef, 'participants'), (snap) => {
      const participants = snap.val() || {};
      Object.keys(participants).forEach(otherId => {
        if (otherId !== currentUserId && !peerConnections[otherId]) {
          createPeerConnection(otherId, battleId);
        }
      });
      if (Object.keys(participants).length > 1) exitSoloPreviewMode();
    });

    await firebaseSet(firebaseRef(battleRef, `participants/${currentUserId}`), myRole);

    if (myRole === 'p1') p1Video.srcObject = localStream;
    if (myRole === 'p2') p2Video.srcObject = localStream;

    voteP1Btn.onclick = () => castVote(1);
    voteP2Btn.onclick = () => castVote(2);
  }

  // ... (keep createPeerConnection, createOffer, startTimer, castVote, updateVotes from your previous version)

  // Attach JOIN listeners
  joinBtn.addEventListener('click', enterApp);
  usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') enterApp();
  });

  console.log("App ready – type username and press JOIN");
});
