// app.js - Permission only on queue join + simple manual battle test

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

// DOM Elements (add these if missing)
const p1Stats = document.getElementById('p1-stats');
const p2Stats = document.getElementById('p2-stats');
// ... (keep all other const from before)


// ... (keep rtcConfig and other init)

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

    // NO camera here anymore!

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

// Queue button - NOW starts camera + adds to queue
queueBtn.addEventListener('click', async () => {
  if (!currentUserId) {
    alert("Join first (enter username)");
    return;
  }

  if (!inQueue) {
    // Request camera/microphone HERE (only when user wants to queue/fight)
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

    // For testing: if you want manual start - add a temp button or auto-check
    // For now: prompt in console or add a "Force Start Battle" button below

  } else {
    // Leave queue
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

// To test visibility: Manually create a battle in Firebase console for now
// Or add this temp function & call it from console or add a button
async function forceStartBattleForTesting() {
  // Example: make current user P1, simulate P2 as someone else
  const testBattleId = 'test-battle-' + Date.now();
  await firebaseSet(firebaseRef(firebaseDb, 'currentBattleId'), testBattleId);

  await firebaseSet(firebaseRef(firebaseDb, `battles/${testBattleId}`), {
    p1: currentUserId,
    p2: 'test-friend-uid', // replace with real uid from another tab
    startTime: firebaseServerTimestamp(),
    endTime: Date.now() + 120000,
    votesP1: 0,
    votesP2: 0
  });

  await firebaseSet(firebaseRef(firebaseDb, `battles/${testBattleId}/participants/${currentUserId}`), 'p1');
  addMessage('System', 'Test battle started – your camera should be visible if someone joins as viewer or p2.');
}

// In joinBattle: assign localStream to video based on role
// (keep rest of joinBattle, createPeerConnection, etc. from previous version)

// Example in joinBattle:
if (myRole === 'p1') p1Video.srcObject = localStream;
if (myRole === 'p2') p2Video.srcObject = localStream;

// ... keep timer, voting, chat functions (update DB refs as before)
