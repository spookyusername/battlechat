// app.js - Merged with global chat, solo preview mode, full battle logic

document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM ready – starting app");

  // ────────────────────────────────────────────────
  // VARIABLES
  // ────────────────────────────────────────────────
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

  // DOM elements
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
    console.log("Adding message →", user, ":", text);
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
    const videoGrid = document.querySelector('.video-grid');
    videoGrid.classList.add('solo-preview');

    p1Video.srcObject = localStream;
    p1Video.muted = true;
    p1Video.play().catch(e => console.error("Preview play failed:", e));

    p1Username.innerText = currentUser || "WAITING FOR OPPONENT";
    p1Streak.innerText = "0";
    p1Stats.classList.remove('hidden');

    addMessage('System', 'Waiting for someone to join the queue... Your preview is live!', true);
  }

  function exitSoloPreviewMode() {
    const videoGrid = document.querySelector('.video-grid');
    videoGrid.classList.remove('solo-preview');

    p1Video.srcObject = null;
    p2Video.srcObject = null;
  }

  // ────────────────────────────────────────────────
  // JOIN (username → enter site)
  // ────────────────────────────────────────────────
  async function enterApp() {
    console.log("JOIN button pressed");
    const username = usernameInput.value.trim();
    if (!username) {
      alert("Please enter a username");
      return;
    }

    try {
      currentUser = username;
      const credential = await firebaseSignInAnonymously(firebaseAuth);
      currentUserId = credential.user.uid;
      console.log("Signed in as:", currentUserId);

      await firebaseSet(firebaseRef(firebaseDb, `players/${currentUserId}/username`), currentUser);

      overlay.classList.add('hidden');
      appContainer.classList.remove('hidden');

      addMessage('System', `${currentUser} joined the chat.`, true);

      firebaseOnValue(firebaseRef(firebaseDb, 'currentBattleId'), (snap) => {
        const battleId = snap.val();
        if (battleId && !currentBattleId) {
          joinBattle(battleId, 'viewer');
        }
      });

      syncChat();

    } catch (error) {
      console.error("Join failed:", error);
      alert("Could not join: " + error.message);
    }
  }

  // ────────────────────────────────────────────────
  // GLOBAL CHAT – everyone sees everything
  // ────────────────────────────────────────────────
  function syncChat() {
    console.log("Starting global chat listener");
    const chatRef = firebaseRef(firebaseDb, 'chat/global');

    chatMessages.innerHTML = '';
    lastChatKeys.clear();

    firebaseOnValue(chatRef, (snap) => {
      const messages = snap.val() || {};
      console.log("Chat snapshot:", Object.keys(messages).length, "messages");

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
          console.log("Sending:", text);
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
  // QUEUE BUTTON – starts camera + big preview if alone
  // ────────────────────────────────────────────────
  queueBtn.addEventListener('click', async () => {
    console.log("Queue clicked");
    if (!currentUserId) {
      alert("Enter username first");
      return;
    }

    if (!inQueue) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        console.log("Camera OK");

        // Show big preview immediately (solo mode)
        enterSoloPreviewMode();

        inQueue = true;
        queueBtn.innerText = "WAITING IN QUEUE...";
        queueBtn.style.backgroundColor = "#555";

        await firebaseSet(firebaseRef(firebaseDb, `queue/${currentUserId}`), {
          username: currentUser,
          joinedAt: firebaseServerTimestamp()
        });

      } catch (err) {
        console.error("Camera error:", err.name, err.message);
        alert("Cannot access camera/mic: " + err.message + "\n\nTry refresh, allow permission, or incognito.");
        return;
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
      addMessage('System', 'Left queue. Preview stopped.', true);
    }
  });

  // ────────────────────────────────────────────────
  // BATTLE LOGIC (when match found)
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
      streak.p1 = data.p1Streak || 0;
      streak.p2 = data.p2Streak || 0;

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

      startTimer(data.endTime || Date.now() + 120000);
      updateVotes(data.votes || {});
    });

    // Check participants to exit solo mode when someone joins
    firebaseOnValue(firebaseRef(battleRef, 'participants'), (snap) => {
      const participants = snap.val() || {};
      const count = Object.keys(participants).length;

      if (count > 1) {
        exitSoloPreviewMode();
      } else {
        enterSoloPreviewMode();
      }

      Object.keys(participants).forEach(otherId => {
        if (otherId !== currentUserId && !peerConnections[otherId]) {
          createPeerConnection(otherId, battleId);
        }
      });
    });

    await firebaseSet(firebaseRef(battleRef, `participants/${currentUserId}`), myRole);

    if (myRole === 'p1') p1Video.srcObject = localStream;
    if (myRole === 'p2') p2Video.srcObject = localStream;

    voteP1Btn.onclick = () => castVote(1);
    voteP2Btn.onclick = () => castVote(2);
  }

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

    firebaseOnValue(firebaseRef(firebaseDb, `signaling/${battleId}/${otherId}-${currentUserId}/ice`), (snap) => {
      snap.forEach(async child => {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(child.val()));
        } catch (err) {
          console.error("ICE error:", err);
        }
      });
    });

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

  async function castVote(player) {
    if (myRole !== 'viewer') return alert('Only viewers can vote!');
    await firebaseSet(firebaseRef(firebaseDb, `battles/${currentBattleId}/votes/${currentUserId}`), player);
    addMessage('System', `You voted for P${player}.`, true);
  }

  function updateVotes(votes) {
    let p1Count = 0, p2Count = 0;
    Object.values(votes).forEach(v => v === 1 ? p1Count++ : p2Count++);
    firebaseSet(firebaseRef(firebaseDb, `battles/${currentBattleId}`), { votesP1: p1Count, votesP2: p2Count }, { merge: true });
  }

  // ────────────────────────────────────────────────
  // Attach listeners
  // ────────────────────────────────────────────────
  joinBtn.addEventListener('click', enterApp);
  usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') enterApp();
  });

  console.log("App ready – type username and press JOIN");
});
