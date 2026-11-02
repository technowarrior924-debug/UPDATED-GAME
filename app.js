// Game Variables & Scene Setup
let scene, camera, renderer, clock;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let isCrouching = false;
let canJump = false;
let velocity = new THREE.Vector3();

// Player Controls & Stats
let playerHeight = 1.62; 
let targetPlayerHeight = 1.62;
let isLocked = false;
let pitch = 0, yaw = 0;

let headYaw = 0;

let myHealth = 100;
let myKills = 0;
let myDeaths = 0;
let matchTimerString = "10:00";
let isDeadLocal = false;
let playerName = "Player";
let gameStarted = false;

// ⚡ Dash Variables
let isDashing = false;
let dashCooldown = false;
const dashSpeed = 35.0;
const dashDuration = 0.15;
let dashTimer = 0;
let dashDirection = new THREE.Vector3();

// ADS (Aim Down Sights / Right-Click Zoom) Variables
let isAiming = false;
const normalFOV = 90;
const aimedFOV = 60;

// Head Bobbing & Animation Variables
let headBobTimer = 0;
const bobFrequency = 10;
const bobAmplitude = 0.05;
let playerWalkTimer = 0;

// Game Objects
let targets = [];
let bloodParticles = [];
let gun, muzzleFlash;
let isShooting = false;
let recoilTimer = 0;
let localPlayerParts = null;

// Multiplayer Setup
const socket = (typeof io !== 'undefined') ? io() : { on: () => {}, emit: () => {}, id: 'local' };
const otherPlayers = {};
// Chat dedup state: purana server bhi chal raha ho to message 3x na ho
let lastLocalChatText = '';
let lastLocalChatTime = 0;
let lastServerChatKey = '';
let lastServerChatTime = 0;
const shownChatIds = new Set();

// Mobile Controls Setup
let isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
let mobileJoystick = { active: false, x: 0, y: 0 };
let touchLook = { active: false, startX: 0, startY: 0 };

let authInitialized = false;

// -------------------------------------------------------------
// 🎵 SAFE SOUND SYSTEM
// -------------------------------------------------------------
const sounds = {
    shoot: new Audio('sounds/shoot.mp3'),
    jump: new Audio('sounds/jump.mp3'),
    dash: new Audio('sounds/jump.mp3'),
    hit: new Audio('sounds/hit.mp3'),
    death: new Audio('sounds/death.mp3')
};

sounds.shoot.volume = 0.5;
sounds.jump.volume = 0.4;
sounds.dash.volume = 0.6;
sounds.hit.volume = 0.6;
sounds.death.volume = 0.7;

function playSound(soundName) {
    if (sounds[soundName]) {
        try {
            const soundClone = sounds[soundName].cloneNode();
            soundClone.volume = sounds[soundName].volume;
            const playPromise = soundClone.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {});
            }
        } catch (e) {}
    }
}

function unlockAudio() {
    Object.keys(sounds).forEach(key => {
        sounds[key].play().then(() => {
            sounds[key].pause();
            sounds[key].currentTime = 0;
        }).catch(() => {});
    });
    window.removeEventListener('click', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
}
window.addEventListener('click', unlockAudio);
window.addEventListener('touchstart', unlockAudio);

init();
animate();

// -------------------------------------------------------------
// FIREBASE AUTH & PERSISTENT LOGIN SETUP
// -------------------------------------------------------------
function setupAuthListener() {
    if (authInitialized) return;
    const auth = window.firebaseAuth;
    if (!auth || !window.onAuthStateChanged) return;

    authInitialized = true;

    if (window.getRedirectResult) {
        window.getRedirectResult(auth).then((result) => {
            if (result && result.user) {
                showGoogleNamePrompt(result.user);
            }
        }).catch((err) => {});
    }

    window.onAuthStateChanged(auth, (user) => {
        if (user) {
            const savedCustomName = localStorage.getItem(`pointerx_user_${user.uid}`);
            if (savedCustomName && !gameStarted) {
                startGameWithPlayer(savedCustomName);
            } else if (!gameStarted) {
                showGoogleNamePrompt(user);
            }
        } else {
            const storedGuestName = localStorage.getItem('pointerx_guest_name');
            if (storedGuestName && !gameStarted) {
                startGameWithPlayer(storedGuestName);
            } else if (!gameStarted) {
                initNamePrompt();
            }
        }
    });
}

if (window.firebaseAuth) {
    setupAuthListener();
} else {
    window.addEventListener('firebase-ready', setupAuthListener);
    window.addEventListener('load', () => {
        setTimeout(() => {
            if (!authInitialized && !gameStarted) {
                const storedGuestName = localStorage.getItem('pointerx_guest_name');
                if (storedGuestName) {
                    startGameWithPlayer(storedGuestName);
                } else {
                    initNamePrompt();
                }
            }
        }, 1000);
    });
}

window.addEventListener('load', () => {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (window.firebaseAuth && window.signOut) {
                window.signOut(window.firebaseAuth).then(() => {
                    localStorage.removeItem('pointerx_guest_name');
                    location.reload();
                }).catch((error) => {});
            }
        });
    }

    // 🌟 Chat UI Interaction Setup
    setupChatSystem();
});

// -------------------------------------------------------------
// 🌟 CHAT SYSTEM HELPER & LOGIC
// -------------------------------------------------------------
function setupChatSystem() {
    const chatInput = document.getElementById('chat-input');
    const chatInputWrapper = document.getElementById('chat-input-wrapper');
    const sendBtn = document.getElementById('chat-send-btn');

    if (sendBtn) {
        sendBtn.addEventListener('click', () => {
            submitChatMessage();
        });
    }

    if (chatInput) {
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.code === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                submitChatMessage();
            }
        });
    }
}

function submitChatMessage() {
    const chatInput = document.getElementById('chat-input');
    const chatInputWrapper = document.getElementById('chat-input-wrapper');
    if (!chatInput) return;

    const text = chatInput.value.trim();
    if (text !== '') {
        // FIX: Apna message turant khud bhi dikhao, sirf server ke echo ka
        // intezar mat karo. Agar socket connected nahi hai (file:// ya
        // galat port se khola ho) to bhi message gayab nahi hoga.
        // Server ko sirf doosron ko broadcast karna hai, isliye ye
        // message server se wapas nahi aayega aur duplicate nahi hoga.
        const msgId = (socket.id || 'local') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
        shownChatIds.add(msgId);
        appendChatMessage(playerName, text, 'white');
        lastLocalChatText = text;
        lastLocalChatTime = Date.now();
        socket.emit('sendChatMessage', { id: msgId, message: text });
    }
    chatInput.value = '';
    if (chatInputWrapper) chatInputWrapper.style.display = 'none';
    
    // Wapas pointer lock active kar do agar game chal rahi hai
    if (gameStarted && !isDeadLocal) {
        try { document.body.requestPointerLock(); } catch (e) {}
    }
}

function appendChatMessage(sender, text, color = 'white') {
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;

    const msgDiv = document.createElement('div');
    msgDiv.style.color = color;
    msgDiv.style.wordBreak = 'break-word';
    
    if (sender) {
        msgDiv.innerHTML = `<span style="font-weight: bold; color: white;">${sender}:</span> ${text}`;
    } else {
        msgDiv.innerHTML = `<span style="font-weight: bold; color: ${color};">${text}</span>`;
    }

    chatMessages.appendChild(msgDiv);

    // Max 8 messages taaki screen clutter na ho
    if (chatMessages.children.length > 8) {
        chatMessages.removeChild(chatMessages.children[0]);
    }

    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// -------------------------------------------------------------
// PROMPTS & UI
// -------------------------------------------------------------
function showGoogleNamePrompt(user) {
    const oldOverlay = document.getElementById('name-overlay');
    if (oldOverlay) oldOverlay.remove();

    const overlay = document.createElement('div');
    overlay.id = 'name-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(0, 0, 0, 0.9)';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '999999';

    const defaultName = localStorage.getItem(`pointerx_user_${user.uid}`) || user.displayName || "GoogleUser";

    overlay.innerHTML = `
        <div style="background: #1a1a1a; padding: 35px; border-radius: 12px; border: 2px solid #00ffcc; text-align: center; color: white; font-family: monospace; width: 320px; box-shadow: 0 0 20px rgba(0,255,204,0.3);">
            <h2 style="color: #00ffcc; margin-bottom: 10px; margin-top: 0;">WELCOME</h2>
            <p style="font-size: 12px; color: #aaa; margin-bottom: 20px;">Logged in as: ${user.email}</p>
            
            <label style="display: block; text-align: left; font-size: 12px; color: #00ffcc; margin-bottom: 5px;">APNA DISPLAY NAME RAKHO:</label>
            <input type="text" id="google-custom-name" value="${defaultName}" style="width: 100%; box-sizing: border-box; padding: 12px; font-size: 14px; text-align: center; background: #111; color: white; border: 1px solid #444; border-radius: 6px; outline: none; margin-bottom: 20px;">
            
            <button id="start-google-game" style="width: 100%; padding: 12px; font-size: 15px; font-weight: bold; background: #00ffcc; color: #111; border: none; border-radius: 6px; cursor: pointer; margin-bottom: 10px;">START MATCH</button>
            <button id="prompt-logout-btn" style="width: 100%; padding: 10px; font-size: 13px; background: #ff3333; color: white; border: none; border-radius: 6px; cursor: pointer;">LOG OUT</button>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('start-google-game').addEventListener('click', () => {
        const input = document.getElementById('google-custom-name');
        let finalName = input ? input.value.trim() : "GoogleUser";
        if (finalName === "") finalName = "GoogleUser";
        
        localStorage.setItem(`pointerx_user_${user.uid}`, finalName);
        startGameWithPlayer(finalName);
    });

    document.getElementById('prompt-logout-btn').addEventListener('click', () => {
        if (window.firebaseAuth && window.signOut) {
            window.signOut(window.firebaseAuth).then(() => {
                location.reload();
            });
        }
    });
}

function initNamePrompt() {
    const oldOverlay = document.getElementById('name-overlay');
    if (oldOverlay) oldOverlay.remove();

    const overlay = document.createElement('div');
    overlay.id = 'name-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(0, 0, 0, 0.9)';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '999999';

    const defaultGuestName = localStorage.getItem('pointerx_guest_name') || `Player_${Math.floor(Math.random()*1000)}`;

    overlay.innerHTML = `
        <div style="background: #1a1a1a; padding: 35px; border-radius: 12px; border: 2px solid #00ffcc; text-align: center; color: white; font-family: monospace; width: 320px; box-shadow: 0 0 20px rgba(0,255,204,0.3);">
            <h2 style="color: #00ffcc; margin-bottom: 20px; margin-top: 0;">POINTER X</h2>
            
            <button id="google-login-btn" style="width: 100%; padding: 12px; font-size: 15px; font-weight: bold; background: #4285F4; color: white; border: none; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.2);">
                <span style="background: white; color: #4285F4; padding: 3px 8px; border-radius: 4px; font-weight: bold; font-size: 14px;">G</span> Continue with Google
            </button>

            <div style="display: flex; align-items: center; margin: 15px 0; color: #666;">
                <div style="flex: 1; height: 1px; background: #444;"></div>
                <span style="padding: 0 10px; font-size: 12px;">OR GUEST</span>
                <div style="flex: 1; height: 1px; background: #444;"></div>
            </div>

            <input type="text" id="player-name-input" placeholder="Enter your name..." value="${defaultGuestName}" style="width: 100%; box-sizing: border-box; padding: 12px; font-size: 14px; text-align: center; background: #111; color: white; border: 1px solid #444; border-radius: 6px; outline: none; margin-bottom: 15px;">
            
            <button id="join-btn" style="width: 100%; padding: 12px; font-size: 15px; font-weight: bold; background: #00ffcc; color: #111; border: none; border-radius: 6px; cursor: pointer;">PLAY AS GUEST</button>
        </div>
    `;
    document.body.appendChild(overlay);

    const googleBtn = document.getElementById('google-login-btn');
    if (googleBtn) {
        googleBtn.addEventListener('click', () => {
            const auth = window.firebaseAuth;
            const provider = window.googleProvider;
            
            if (auth && provider) {
                if (window.signInWithPopup) {
                    window.signInWithPopup(auth, provider)
                        .then((result) => {
                            showGoogleNamePrompt(result.user);
                        })
                        .catch((error) => {
                            if (error.code === 'auth/popup-blocked' && window.signInWithRedirect) {
                                window.signInWithRedirect(auth, provider);
                            } else {
                                alert("Google Login Failed: " + (error.message || "Try again."));
                            }
                        });
                } else if (window.signInWithRedirect) {
                    window.signInWithRedirect(auth, provider);
                }
            } else {
                alert("Firebase Auth is still initializing. Please wait a second!");
            }
        });
    }

    const joinBtn = document.getElementById('join-btn');
    if (joinBtn) {
        joinBtn.addEventListener('click', () => {
            const input = document.getElementById('player-name-input');
            let pName = input ? input.value.trim() : "Player";
            if (pName === "") pName = "Player";
            localStorage.setItem('pointerx_guest_name', pName);
            startGameWithPlayer(pName);
        });
    }
}

function startGameWithPlayer(name) {
    playerName = name;
    const overlay = document.getElementById('name-overlay');
    if (overlay) overlay.remove();

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.style.display = 'block';

    gameStarted = true;
    socket.emit('setPlayerName', playerName);
    updateHUD();

    if (isMobile) {
        setupMobileControls();
        isLocked = true;
    } else {
        const blocker = document.getElementById('blocker');
        if (blocker) {
            blocker.style.display = 'none';
        }
        document.body.requestPointerLock();
    }
}

// -------------------------------------------------------------
// 🎯 HITMARKER EFFECT FUNCTION
// -------------------------------------------------------------
function triggerHitMarker(isHeadshot = false) {
    let crosshair = document.getElementById('crosshair');
    if (!crosshair) return;

    crosshair.style.backgroundColor = '#ff0000';
    crosshair.style.transform = 'translate(-50%, -50%) rotate(45deg) scale(1.6)';
    crosshair.style.boxShadow = isHeadshot ? '0 0 10px #ff0000, 0 0 20px #ff0000' : '0 0 8px #ff3300';

    setTimeout(() => {
        crosshair.style.backgroundColor = '#00ff00';
        crosshair.style.transform = 'translate(-50%, -50%) rotate(0deg) scale(1)';
        crosshair.style.boxShadow = 'none';
    }, 100);

    const popup = document.createElement('div');
    popup.innerText = isHeadshot ? "🎯 HEADSHOT!" : "💥 HIT";
    popup.style.position = 'fixed';
    popup.style.top = '46%';
    popup.style.left = '52%';
    popup.style.transform = 'translate(-50%, -50%)';
    popup.style.color = isHeadshot ? '#ff0000' : '#ffcc00';
    popup.style.fontSize = isHeadshot ? '20px' : '14px';
    popup.style.fontWeight = 'bold';
    popup.style.fontFamily = 'monospace';
    popup.style.pointerEvents = 'none';
    popup.style.zIndex = '999';
    popup.style.textShadow = '1px 1px 2px #000';
    document.body.appendChild(popup);

    setTimeout(() => {
        popup.remove();
    }, 350);
}

// -------------------------------------------------------------
// THREE.JS SCENE INITIALIZATION & MULTIPLAYER SOCKET LISTENERS
// -------------------------------------------------------------
function init() {
    clock = new THREE.Clock();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a1a);

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load('night-sky.png', 
        (texture) => {
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
            scene.background = texture;
        }, 
        undefined, 
        () => {}
    );

    scene.fog = new THREE.Fog(0x0a0a1a, 50, 250);

    camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, playerHeight, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    scene.add(dirLight);

    createMap();
    createGun();

    if (!isMobile) {
        setupPointerLock();
    }

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    
    window.addEventListener('mousedown', (e) => {
        if (!isLocked || isDeadLocal || !gameStarted) return;
        if (e.button === 0) {
            shoot(e);
        } else if (e.button === 2) {
            isAiming = true;
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 2) {
            isAiming = false;
        }
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());

    // 🌟 MULTIPLAYER SOCKET SYNC & CHAT LISTENERS
    socket.on('currentPlayers', (serverPlayers) => {
        Object.keys(serverPlayers).forEach((id) => {
            if (id === socket.id) return;
            createOtherPlayerMesh(id, serverPlayers[id]);
        });
    });

    socket.on('newPlayer', (data) => {
        createOtherPlayerMesh(data.id, data.player);
    });

    socket.on('chatMessage', (data) => {
        // DEDUP (ID wala, sab se pakka): ek hi message ki id dobara
        // aaye to skip karo. Purana duplicate server ho ya naya, 1x hi dikhega.
        if (data.id) {
            if (shownChatIds.has(data.id)) return;
            shownChatIds.add(data.id);
            if (shownChatIds.size > 200) shownChatIds.clear();
        }
        const _now = Date.now();
        // Fallback: purana server id forward na kare to bhi apna message dobara na dikhe
        if (data.name === playerName && data.message === lastLocalChatText && _now - lastLocalChatTime < 5000) return;
        const _key = data.name + '\0' + data.message;
        if (_key === lastServerChatKey && _now - lastServerChatTime < 2000) return;
        lastServerChatKey = _key;
        lastServerChatTime = _now;
        appendChatMessage(data.name, data.message, 'white');
    });

    socket.on('playerJoinedNotif', (name) => {
        appendChatMessage('', `${name} Joined the game`, '#00ff00'); // Green text like screenshot
    });

    socket.on('playerLeftNotif', (name) => {
        appendChatMessage('', `${name} Left the game`, '#ff3333'); // Red text like screenshot
    });

    socket.on('gameNotification', (msg) => {
        showGameNotification(msg);
    });

    socket.on('timerUpdate', (totalSeconds) => {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        matchTimerString = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        updateHUD();
    });

    socket.on('playerStatsUpdate', (data) => {
        if (data.targetId === socket.id) {
            myDeaths = data.targetDeaths;
        }
        if (data.attackerId === socket.id) {
            myKills = data.attackerKills;
        }
        updateHUD();
    });

    socket.on('playerMoved', (data) => {
        if (otherPlayers[data.id]) {
            const p = otherPlayers[data.id];
            if (p.isDead) return;
            
            const targetY = data.player.isCrouching ? (data.player.y - 2.1) : (data.player.y - 1.62);
            p.mesh.position.set(data.player.x, targetY, data.player.z);
            // POORA PLAYER ROTATE: model originally +Z ko munh karta hai,
            // movement -Z hai, isliye poori mesh ko PI (180 deg) ghumaya.
            p.mesh.rotation.y = data.player.yaw + Math.PI;

            if (p.nameTag) {
                p.nameTag.position.set(data.player.x, targetY + 2.4, data.player.z);
            }

            if (data.player.isDashing) {
                spawnGhostShade(data.player.x, targetY, data.player.z, data.player.yaw);
            }

            if (data.player.isCrouching) {
                p.leftLeg.rotation.x = -0.5;
                p.rightLeg.rotation.x = -0.5;
                p.rightArm.rotation.x = -0.6;
                p.body.position.y = 0.9;
                p.head.position.y = 1.4;
            } else {
                p.body.position.y = 1.125;
                p.head.position.y = 1.75;

                if (data.player.isMoving) {
                    p.walkTimer += 0.15;
                    const angle = Math.sin(p.walkTimer) * 0.6;
                    p.leftLeg.rotation.x = -angle;
                    p.rightLeg.rotation.x = angle;
                    p.rightArm.rotation.x = angle;
                } else {
                    p.walkTimer = 0;
                    p.leftLeg.rotation.x += (0 - p.leftLeg.rotation.x) * 0.2;
                    p.rightLeg.rotation.x += (0 - p.rightLeg.rotation.x) * 0.2;
                    p.rightArm.rotation.x += (-0.6 - p.rightArm.rotation.x) * 0.2;
                }
            }
        }
    });

    socket.on('spawnBlood', (pos) => {
        spawnBloodSplatter(pos);
    });

    socket.on('playerDied', (data) => {
        if (data.id === socket.id) {
            isDeadLocal = true;
            myHealth = 0;
            camera.position.y = 0.4;
            playSound('death');
            showRespawnScreen(3);
        }
        if (otherPlayers[data.id]) {
            const p = otherPlayers[data.id];
            p.isDead = true;
            if (p.nameTag) p.nameTag.position.y = 1.0;
        }
    });

    socket.on('playerRespawned', (data) => {
        if (data.id === socket.id) {
            isDeadLocal = false;
            myHealth = 100;
            hideRespawnScreen();
            camera.position.set(data.player.x, playerHeight, data.player.z);
        }
        if (otherPlayers[data.id]) {
            const p = otherPlayers[data.id];
            p.isDead = false;
            p.mesh.rotation.set(0, (data.player.yaw || 0) + Math.PI, 0);
            p.mesh.position.set(data.player.x, data.player.y - 1.62, data.player.z);
            p.mesh.traverse((child) => {
                if (child.isMesh && child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.opacity = 1.0);
                    } else {
                        child.material.opacity = 1.0;
                    }
                }
            });
            if (p.nameTag) p.nameTag.position.set(data.player.x, data.player.y + 0.8, data.player.z);
        }
    });

    socket.on('playerHealthUpdate', (data) => {
        if (data.id === socket.id) {
            myHealth = data.health;
            updateHUD();
        }
    });

    socket.on('playerDisconnect', (id) => {
        if (otherPlayers[id]) {
            const mesh = otherPlayers[id].mesh;
            scene.remove(mesh);
            if (otherPlayers[id].nameTag) {
                scene.remove(otherPlayers[id].nameTag);
            }
            const meshParts = [];
            mesh.traverse(child => { if (child.isMesh) meshParts.push(child); });
            targets = targets.filter(t => !meshParts.includes(t));
            delete otherPlayers[id];
        }
    });
}

function updateHUD() {
    let hud = document.getElementById('hud');
    
    const kdRatio = myDeaths === 0 ? myKills.toFixed(2) : (myKills / myDeaths).toFixed(2);

    // Neeche se KILLS / DEATHS / K/D hata diye - ab sirf TIME, PLAYER, HEALTH, AMMO rahenge
    if (hud) {
        // Neeche se TIME bhi hata diya - time ab sirf upar center wale black box me hai
        hud.innerHTML = `PLAYER: ${playerName}<br>` +
                        `HEALTH: ${myHealth} | AMMO: 30 / 30`;
    }

    // Upar left me dots wali score: red = Death, green = Kill, yellow = K/D
    // FIX: Agar index.html me #score-dots div nahi hai (sirf app.js copy
    // kiya ho) to bhi dots dikhne chahiye, isliye div khud bana lo.
    // Pehle wala code sirf tab kaam karta tha jab div pehle se maujood ho,
    // warna kuch show hi nahi hota tha.
    let dots = document.getElementById('score-dots');
    if (!dots) {
        dots = document.createElement('div');
        dots.id = 'score-dots';
        dots.style.position = 'absolute';
        dots.style.top = '20px';
        dots.style.left = '20px';
        dots.style.display = 'flex';
        dots.style.flexDirection = 'column';
        dots.style.gap = '4px';
        dots.style.fontFamily = 'monospace';
        dots.style.fontSize = '16px';
        dots.style.fontWeight = 'bold';
        dots.style.textShadow = '2px 2px black';
        dots.style.zIndex = '100';
        dots.style.pointerEvents = 'none';
        document.body.appendChild(dots);
    }
    // Upar center me time (screenshot me 9:00 wala black box) - ye pehle tha hi nahi,
    // isliye time sirf neeche dikhta tha. Ab ye bhi update hoga, aur agar div
    // index.html me na ho to khud ban jayega.
    let timerEl = document.getElementById('match-timer');
    if (!timerEl) {
        timerEl = document.createElement('div');
        timerEl.id = 'match-timer';
        timerEl.style.position = 'absolute';
        timerEl.style.top = '20px';
        timerEl.style.left = '50%';
        timerEl.style.transform = 'translateX(-50%)';
        timerEl.style.background = '#000';
        timerEl.style.color = '#fff';
        timerEl.style.padding = '8px 28px';
        timerEl.style.fontFamily = 'monospace';
        timerEl.style.fontSize = '28px';
        timerEl.style.fontWeight = 'bold';
        timerEl.style.zIndex = '100';
        timerEl.style.pointerEvents = 'none';
        document.body.appendChild(timerEl);
    }
    timerEl.textContent = matchTimerString;

    const dotStyle = 'display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 8px; vertical-align: middle;';
    dots.innerHTML =
        `<div style="color: #ff3333;"><span style="${dotStyle} background: #ff3333;"></span>${myDeaths}</div>` +
        `<div style="color: #00ff00;"><span style="${dotStyle} background: #00ff00;"></span>${myKills}</div>` +
        `<div style="color: #ffcc00;"><span style="${dotStyle} background: #ffcc00;"></span>${kdRatio}</div>`;
}

function showGameNotification(message) {
    let notif = document.getElementById('game-notif');
    if (!notif) {
        notif = document.createElement('div');
        notif.id = 'game-notif';
        notif.style.position = 'absolute';
        notif.style.top = '80px';
        notif.style.left = '50%';
        notif.style.transform = 'translateX(-50%)';
        notif.style.background = 'rgba(0, 0, 0, 0.6)';
        notif.style.color = '#00ffcc';
        notif.style.padding = '8px 16px';
        notif.style.borderRadius = '5px';
        notif.style.fontFamily = 'monospace';
        notif.style.fontSize = '14px';
        notif.style.fontWeight = 'bold';
        notif.style.zIndex = '100';
        document.body.appendChild(notif);
    }
    notif.innerText = message;
    notif.style.opacity = '1';

    setTimeout(() => {
        notif.style.opacity = '0';
    }, 3500);
}

function createNameTag(name) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(1.2, 0.3, 1);
    return sprite;
}

function showRespawnScreen(secondsLeft) {
    let respawnDiv = document.getElementById('respawn-screen');
    if (!respawnDiv) {
        respawnDiv = document.createElement('div');
        respawnDiv.id = 'respawn-screen';
        respawnDiv.style.position = 'absolute';
        respawnDiv.style.top = '50%';
        respawnDiv.style.left = '50%';
        respawnDiv.style.transform = 'translate(-50%, -50%)';
        respawnDiv.style.color = 'red';
        respawnDiv.style.fontFamily = 'monospace';
        respawnDiv.style.fontSize = '36px';
        respawnDiv.style.fontWeight = 'bold';
        respawnDiv.style.textShadow = '2px 2px black';
        respawnDiv.style.zIndex = '1000';
        respawnDiv.style.transition = 'opacity 0.5s ease';
        respawnDiv.style.opacity = '1';
        document.body.appendChild(respawnDiv);
    }

    if (secondsLeft <= 0) {
        hideRespawnScreen();
        return;
    }

    respawnDiv.innerText = `YOU DIED! Respawning in ${secondsLeft}s...`;

    setTimeout(() => {
        showRespawnScreen(secondsLeft - 1);
    }, 1000);
}

function hideRespawnScreen() {
    const respawnDiv = document.getElementById('respawn-screen');
    if (respawnDiv) {
        respawnDiv.style.opacity = '0';
        setTimeout(() => {
            respawnDiv.remove();
        }, 500);
    }
    updateHUD();
}

function spawnBloodSplatter(pos) {
    const particleCount = 12;
    const geometry = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });

    for (let i = 0; i < particleCount; i++) {
        const particle = new THREE.Mesh(geometry, material);
        particle.position.set(pos.x, pos.y + 1.2, pos.z);

        const vel = new THREE.Vector3(
            (Math.random() - 0.5) * 6,
            Math.random() * 5 + 2,
            (Math.random() - 0.5) * 6
        );

        scene.add(particle);
        bloodParticles.push({ mesh: particle, velocity: vel, life: 0.5 });
    }
}

function spawnGhostShade(x, y, z, rotY) {
    const ghostGroup = new THREE.Group();
    const ghostMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.5 });
    
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.75, 0.3), ghostMat);
    body.position.y = 1.125;
    ghostGroup.add(body);

    ghostGroup.position.set(x, y, z);
    ghostGroup.rotation.y = rotY;
    scene.add(ghostGroup);

    let fadeLife = 0.3;
    const fadeInterval = setInterval(() => {
        fadeLife -= 0.05;
        ghostMat.opacity = fadeLife;
        if (fadeLife <= 0) {
            clearInterval(fadeInterval);
            scene.remove(ghostGroup);
        }
    }, 30);
}

function createMap() {
    const arenaSize = 500;
    const floorGeo = new THREE.PlaneGeometry(arenaSize, arenaSize);
    
    const textureLoader = new THREE.TextureLoader();
    const groundTexture = textureLoader.load('ground-texture.png', (texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(50, 50);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
    });

    const floorMat = new THREE.MeshStandardMaterial({ map: groundTexture, color: 0x555555 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const wallHeight = 10;
    const wallThickness = 2;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });

    const wallN = new THREE.Mesh(new THREE.BoxGeometry(arenaSize, wallHeight, wallThickness), wallMat);
    wallN.position.set(0, wallHeight / 2, -arenaSize / 2);
    scene.add(wallN);

    const wallS = new THREE.Mesh(new THREE.BoxGeometry(arenaSize, wallHeight, wallThickness), wallMat);
    wallS.position.set(0, wallHeight / 2, arenaSize / 2);
    scene.add(wallS);

    const wallE = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallHeight, arenaSize), wallMat);
    wallE.position.set(arenaSize / 2, wallHeight / 2, 0);
    scene.add(wallE);

    const wallW = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallHeight, arenaSize), wallMat);
    wallW.position.set(-arenaSize / 2, wallHeight / 2, 0);
    scene.add(wallW);

    const boxGeo = new THREE.BoxGeometry(2, 2, 2);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });

    for (let i = 0; i < 40; i++) {
        const crate = new THREE.Mesh(boxGeo, boxMat);
        const rx = (Math.random() - 0.5) * (arenaSize - 40);
        const rz = (Math.random() - 0.5) * (arenaSize - 40);
        crate.position.set(rx, 1, rz);
        scene.add(crate);
    }
}

function createGun() {
    const gunGroup = new THREE.Group();

    const bodyGeo = new THREE.BoxGeometry(0.15, 0.2, 0.8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1f1f1f, roughness: 0.3 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(0.25, -0.25, -0.5);
    gunGroup.add(body);

    const topGeo = new THREE.BoxGeometry(0.1, 0.08, 0.5);
    const topMat = new THREE.MeshStandardMaterial({ color: 0x2e2e2e });
    const topPart = new THREE.Mesh(topGeo, topMat);
    topPart.position.set(0.25, -0.13, -0.5);
    gunGroup.add(topPart);

    const neonMat = new THREE.MeshBasicMaterial({ color: 0x00d2ff });
    
    const stripe1 = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.01, 0.3), neonMat);
    stripe1.position.set(0.25, -0.09, -0.5);
    gunGroup.add(stripe1);

    const stripe2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.15), neonMat);
    stripe2.position.set(0.31, -0.22, -0.35);
    gunGroup.add(stripe2);

    const barrelGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.4);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.25, -0.22, -0.95);
    gunGroup.add(barrel);

    const flashGeo = new THREE.SphereGeometry(0.06);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0x00d2ff });
    muzzleFlash = new THREE.Mesh(flashGeo, flashMat);
    muzzleFlash.position.set(0.25, -0.22, -1.15);
    muzzleFlash.visible = false;
    gunGroup.add(muzzleFlash);

    gun = gunGroup;
    camera.add(gun);
    scene.add(camera);

    localPlayerParts = null; 
}

function createSteveHeadMaterials() {
    const hairColor = '#3b2416';
    const hairDarkColor = '#2d1a0e';
    const skinColor = '#c68642';
    const skinDarkColor = '#ad6f32';
    const eyeWhite = '#ffffff';
    const eyeBlue = '#3b3b9b';
    const mouthColor = '#4a2511';

    function makeFaceCanvas(drawFn) {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = hairColor;
        ctx.fillRect(0, 0, 64, 64);
        drawFn(ctx);
        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        return new THREE.MeshStandardMaterial({ map: texture, transparent: true });
    }

    const matRight = makeFaceCanvas((ctx) => {
        ctx.fillStyle = skinColor;
        ctx.fillRect(0, 24, 64, 40);
        ctx.fillStyle = hairColor;
        ctx.fillRect(0, 0, 64, 24);
        ctx.fillRect(32, 24, 32, 16);
    });

    const matLeft = makeFaceCanvas((ctx) => {
        ctx.fillStyle = skinColor;
        ctx.fillRect(0, 24, 64, 40);
        ctx.fillStyle = hairColor;
        ctx.fillRect(0, 0, 64, 24);
        ctx.fillRect(0, 24, 32, 16);
    });

    const matTop = makeFaceCanvas((ctx) => {
        ctx.fillStyle = hairColor;
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = hairDarkColor;
        ctx.fillRect(16, 16, 32, 32);
    });

    const matBottom = makeFaceCanvas((ctx) => {
        ctx.fillStyle = skinDarkColor;
        ctx.fillRect(0, 0, 64, 64);
    });

    const matFront = makeFaceCanvas((ctx) => {
        ctx.fillStyle = skinColor;
        ctx.fillRect(0, 24, 64, 40);
        ctx.fillStyle = hairColor;
        ctx.fillRect(0, 0, 64, 24);
        ctx.fillStyle = eyeWhite;
        ctx.fillRect(8, 32, 16, 8);
        ctx.fillRect(40, 32, 16, 8);
        ctx.fillStyle = eyeBlue;
        ctx.fillRect(16, 32, 8, 8);
        ctx.fillRect(40, 32, 8, 8);
        ctx.fillStyle = mouthColor;
        ctx.fillRect(24, 44, 16, 12);
        ctx.fillStyle = skinDarkColor;
        ctx.fillRect(24, 40, 16, 4);
    });

    const matBack = makeFaceCanvas((ctx) => {
        ctx.fillStyle = hairColor;
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = skinColor;
        ctx.fillRect(16, 48, 32, 16);
    });

    // Front/back materials ko chheda nahi - poora player model hi 180 degree
    // rotate kiya gaya hai (neeche playerMoved me), isliye ye original order
    // hi sahi rahega: face +Z local, jo rotate hone ke baad -Z world (aage) banega.
    return [matRight, matLeft, matTop, matBottom, matFront, matBack];
}

function createSteveCharacter(playerId) {
    const steveGroup = new THREE.Group();

    const shirtMat = new THREE.MeshStandardMaterial({ color: 0x00a8b5, transparent: true });
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x3b449b, transparent: true });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xc68642, transparent: true });

    const legGeo = new THREE.BoxGeometry(0.28, 0.75, 0.3);
    
    const leftLeg = new THREE.Mesh(legGeo, pantsMat);
    leftLeg.position.set(-0.15, 0.375, 0);
    leftLeg.userData = { id: playerId, bodyPart: 'leg' };
    steveGroup.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, pantsMat);
    rightLeg.position.set(0.15, 0.375, 0);
    rightLeg.userData = { id: playerId, bodyPart: 'leg' };
    steveGroup.add(rightLeg);

    const bodyGeo = new THREE.BoxGeometry(0.6, 0.75, 0.3);
    const body = new THREE.Mesh(bodyGeo, shirtMat);
    body.position.y = 1.125;
    body.userData = { id: playerId, bodyPart: 'body' };
    steveGroup.add(body);

    const armGeo = new THREE.BoxGeometry(0.28, 0.75, 0.28);
    
    const leftArmGroup = new THREE.Group();
    leftArmGroup.position.set(-0.44, 1.4, 0); 
    const leftArm = new THREE.Mesh(armGeo, skinMat);
    leftArm.position.set(0, -0.275, 0);
    leftArm.userData = { id: playerId, bodyPart: 'hand' };
    leftArmGroup.add(leftArm);
    steveGroup.add(leftArmGroup);

    const rightArmGroup = new THREE.Group();
    rightArmGroup.position.set(0.44, 1.4, 0);
    const rightArm = new THREE.Mesh(armGeo, skinMat);
    rightArm.position.set(0, -0.275, 0);
    rightArm.userData = { id: playerId, bodyPart: 'hand' };
    rightArmGroup.add(rightArm);
    steveGroup.add(rightArmGroup);

    const headMaterials = createSteveHeadMaterials();
    const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const head = new THREE.Mesh(headGeo, headMaterials);
    head.position.y = 1.75;
    head.rotation.y = 0;
    head.userData = { id: playerId, bodyPart: 'head' };
    steveGroup.add(head);

    return {
        group: steveGroup,
        leftLeg,
        rightLeg,
        leftArmGroup,
        rightArmGroup,
        body,
        head
    };
}

function createOtherPlayerMesh(id, playerData) {
    if (otherPlayers[id]) return;

    const steveChar = createSteveCharacter(id);
    const playerMesh = steveChar.group;

    const playerGunGroup = new THREE.Group();
// Gun ko arm ka bacha MAT banao, mesh ka bacha banao.
// Ab arm kitna bhi tilt ho, gun ka munh hamesha samne horizontal rahega, upar nahi jayega.
playerGunGroup.position.set(-0.44, 1.4, 0);
const gunBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.15, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x222222, transparent: true })
);
gunBody.position.set(0, -0.3, 0.3);
playerGunGroup.add(gunBody);

const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x111111, transparent: true })
);
barrel.rotation.x = Math.PI / 2;
barrel.position.set(0, -0.3, 0.6);
playerGunGroup.add(barrel);

// BLUE DESIGN: first-person gun wali neon blue stripes
const neonMat = new THREE.MeshBasicMaterial({ color: 0x00d2ff });
const stripeTop = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.02, 0.35), neonMat);
stripeTop.position.set(0, -0.215, 0.3);
playerGunGroup.add(stripeTop);
const stripeSide = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.20), neonMat);
stripeSide.position.set(-0.07, -0.30, 0.45);
playerGunGroup.add(stripeSide);

// Gun group par koi rotation mat lagao - barrel +Z local = samne horizontal
playerMesh.add(playerGunGroup);

// 2-HAND HOLD pose (sirf haathon ke liye, gun inse attach nahi)
steveChar.leftArmGroup.rotation.x = -0.9;
steveChar.rightArmGroup.rotation.x = -0.9;
steveChar.rightArmGroup.rotation.z = -0.6;
steveChar.leftLeg.rotation.z = -0.08;
steveChar.rightLeg.rotation.z = 0.08;


    playerMesh.rotation.y = (playerData.yaw || 0) + Math.PI;
    playerMesh.position.set(playerData.x, playerData.y - 1.62, playerData.z);
    scene.add(playerMesh);

    const nameTag = createNameTag(playerData.name || "Player");
    nameTag.position.set(playerData.x, playerData.y + 0.8, playerData.z);
    scene.add(nameTag);

    playerMesh.traverse((child) => {
        if (child.isMesh && child.userData && child.userData.bodyPart) {
            targets.push(child);
        }
    });

    otherPlayers[id] = {
        mesh: playerMesh,
        nameTag: nameTag,
        leftLeg: steveChar.leftLeg,
        rightLeg: steveChar.rightLeg,
        leftArm: steveChar.leftArmGroup,
        rightArm: steveChar.rightArmGroup,
        body: steveChar.body,
        head: steveChar.head,
        walkTimer: 0,
        isDead: false
    };
}

function setupPointerLock() {
    const blocker = document.getElementById('blocker');

    renderer.domElement.addEventListener('click', () => {
        if (gameStarted && !isLocked && !isDeadLocal) {
            document.body.requestPointerLock();
        }
    });

    if (blocker) {
        blocker.addEventListener('click', () => {
            if (gameStarted && !isDeadLocal) {
                document.body.requestPointerLock();
            }
        });
    }

    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === document.body) {
            isLocked = true;
            if (blocker) blocker.style.display = 'none';
        } else {
            isLocked = false;
            if (gameStarted && !isDeadLocal && blocker) {
                blocker.style.display = 'flex';
            }
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!isLocked || !gameStarted) return;

        const mouseSensitivity = 0.002;
        let deltaX = e.movementX * mouseSensitivity;
        let deltaY = e.movementY * mouseSensitivity;

        pitch -= deltaY;
        pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, pitch));

        headYaw -= deltaX;
    });
}

function setupMobileControls() {
    if (!isMobile) return;

    const oldUI = document.getElementById('mobile-controls-ui');
    if (oldUI) oldUI.remove();

    const ui = document.createElement('div');
    ui.id = 'mobile-controls-ui';
    ui.style.position = 'fixed';
    ui.style.top = '0';
    ui.style.left = '0';
    ui.style.width = '100vw';
    ui.style.height = '100vh';
    ui.style.pointerEvents = 'none';
    ui.style.zIndex = '99999';

    ui.innerHTML = `
        <div id="joystick-zone" style="position: absolute; bottom: 20px; left: 20px; width: 140px; height: 140px; background: rgba(255,255,255,0.1); border: 2px solid rgba(255,255,255,0.3); border-radius: 50%; pointer-events: auto; touch-action: none;">
            <div id="joystick-thumb" style="position: absolute; top: 45px; left: 45px; width: 50px; height: 50px; background: rgba(0,255,204,0.7); border-radius: 50%; pointer-events: none;"></div>
        </div>
        <div style="position: absolute; bottom: 30px; right: 30px; display: flex; gap: 15px; pointer-events: auto;">
            <button id="mob-dash" style="width: 55px; height: 55px; background: rgba(255,165,0,0.8); color: white; border: 2px solid white; border-radius: 50%; font-weight: bold; outline: none;">DASH</button>
            <button id="mob-jump" style="width: 65px; height: 65px; background: rgba(0,168,181,0.8); color: white; border: 2px solid white; border-radius: 50%; font-weight: bold; outline: none;">JUMP</button>
            <button id="mob-fire" style="width: 75px; height: 75px; background: rgba(255,34,34,0.8); color: white; border: 2px solid white; border-radius: 50%; font-weight: bold; outline: none;">FIRE</button>
        </div>
    `;
    document.body.appendChild(ui);

    const zone = document.getElementById('joystick-zone');
    const thumb = document.getElementById('joystick-thumb');
    let centerX = 0, centerY = 0;

    zone.addEventListener('touchstart', (e) => {
        const touch = e.targetTouches[0];
        const rect = zone.getBoundingClientRect();
        centerX = rect.left + rect.width / 2;
        centerY = rect.top + rect.height / 2;
        mobileJoystick.active = true;
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (!mobileJoystick.active) return;
        for (let i = 0; i < e.touches.length; i++) {
            const touch = e.touches[i];
            if (touch.clientX < window.innerWidth / 2) {
                let dx = touch.clientX - centerX;
                let dy = touch.clientY - centerY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const maxRad = 45;

                if (dist > maxRad) {
                    dx = (dx / dist) * maxRad;
                    dy = (dy / dist) * maxRad;
                }

                thumb.style.transform = `translate(${dx}px, ${dy}px)`;
                mobileJoystick.x = dx / maxRad;
                mobileJoystick.y = dy / maxRad;
            }
        }
    }, { passive: true });

    window.addEventListener('touchend', () => {
        mobileJoystick.active = false;
        mobileJoystick.x = 0;
        mobileJoystick.y = 0;
        thumb.style.transform = `translate(0px, 0px)`;
    });

    window.addEventListener('touchstart', (e) => {
        const touch = e.targetTouches[0];
        if (touch.clientX >= window.innerWidth / 2) {
            touchLook.active = true;
            touchLook.startX = touch.clientX;
            touchLook.startY = touch.clientY;
        }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (!touchLook.active) return;
        for (let i = 0; i < e.touches.length; i++) {
            const touch = e.touches[i];
            if (touch.clientX >= window.innerWidth / 2) {
                const diffX = touch.clientX - touchLook.startX;
                const diffY = touch.clientY - touchLook.startY;

                headYaw -= diffX * 0.005;
                pitch -= diffY * 0.005;
                pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));

                touchLook.startX = touch.clientX;
                touchLook.startY = touch.clientY;
            }
        }
    }, { passive: true });

    window.addEventListener('touchend', () => {
        touchLook.active = false;
    });

    document.getElementById('mob-jump').addEventListener('touchstart', (e) => {
        e.stopPropagation();
        if (canJump && !isDeadLocal) {
            velocity.y = 8.5;
            canJump = false;
            playSound('jump');
        }
    });

    document.getElementById('mob-dash').addEventListener('touchstart', (e) => {
        e.stopPropagation();
        triggerDash();
    });

    document.getElementById('mob-fire').addEventListener('touchstart', (e) => {
        e.stopPropagation();
        shootMobile();
    });
}

function triggerDash() {
    if (isDashing || dashCooldown || isDeadLocal || !gameStarted) return;

    isDashing = true;
    dashCooldown = true;
    dashTimer = dashDuration;
    playSound('dash');

    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw + headYaw);
    const side = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw + headYaw);

    dashDirection.set(0, 0, 0);
    let inputX = (moveRight ? 1 : 0) - (moveLeft ? 1 : 0);
    let inputZ = (moveForward ? 1 : 0) - (moveBackward ? 1 : 0);

    if (isMobile && mobileJoystick.active) {
        inputX += mobileJoystick.x;
        inputZ += -mobileJoystick.y;
    }

    if (inputX !== 0 || inputZ !== 0) {
        dashDirection.addScaledVector(forward, inputZ);
        dashDirection.addScaledVector(side, inputX);
        dashDirection.normalize();
    } else {
        dashDirection.copy(forward);
    }

    setTimeout(() => {
        dashCooldown = false;
    }, 1000);
}

function shootMobile() {
    if (isDeadLocal || !gameStarted) return;

    playSound('shoot');

    isShooting = true;
    recoilTimer = 0.08;
    muzzleFlash.visible = true;
    setTimeout(() => { muzzleFlash.visible = false; }, 60);

    scene.updateMatrixWorld(true);

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObjects(targets, true);

    if (intersects.length > 0) {
        const hitMesh = intersects[0].object;
        if (hitMesh.userData && hitMesh.userData.id) {
            const targetId = hitMesh.userData.id;
            const part = hitMesh.userData.bodyPart;

            let damage = 0;
            let isHeadshot = false;

            if (part === 'head') {
                damage = 100;
                isHeadshot = true;
            } else if (part === 'body') {
                damage = 50;
            } else if (part === 'leg') {
                damage = 20;
            } else if (part === 'hand') {
                damage = 15;
            }

            triggerHitMarker(isHeadshot);
            playSound('hit');

            const hitPoint = intersects[0].point;
            socket.emit('playerHit', { targetId, damage, x: hitPoint.x, y: hitPoint.y, z: hitPoint.z });
        }
    }
}

function onKeyDown(e) {
    if (!gameStarted) return;
    // Chat me type karte waqt movement keys (W/A/S/D/Space) na chalein
    const _chatInput = document.getElementById('chat-input');
    if (_chatInput && document.activeElement === _chatInput) return;

    // 🌟 'T' Key dabane par Chat Input open hoga aur mouse pointer unlock ho jayega
    if (e.code === 'KeyT') {
        const chatInputWrapper = document.getElementById('chat-input-wrapper');
        const chatInput = document.getElementById('chat-input');
        if (chatInputWrapper && chatInput && document.activeElement !== chatInput) {
            e.preventDefault();
            chatInputWrapper.style.display = 'flex';
            chatInput.focus();
            document.exitPointerLock();
            return;
        }
    }

    switch (e.code) {
        case 'KeyW': moveForward = true; break;
        case 'KeyS': moveBackward = true; break;
        case 'KeyA': moveLeft = true; break;
        case 'KeyD': moveRight = true; break;
        case 'KeyE': triggerDash(); break;
        case 'ShiftLeft':
        case 'ShiftRight':
            isCrouching = true;
            break;
        case 'Space': 
            if (canJump && !isCrouching && !isDeadLocal) {
                velocity.y = 8.5; 
                canJump = false;
                playSound('jump');
            }
            break;
    }
}

function onKeyUp(e) {
    if (!gameStarted) return;
    const _chatInput = document.getElementById('chat-input');
    if (_chatInput && document.activeElement === _chatInput) return;
    switch (e.code) {
        case 'KeyW': moveForward = false; break;
        case 'KeyS': moveBackward = false; break;
        case 'KeyA': moveLeft = false; break;
        case 'KeyD': moveRight = false; break;
        case 'ShiftLeft':
        case 'ShiftRight':
            isCrouching = false;
            break;
    }
}

function shoot(e) {
    if (!isLocked || e.button !== 0 || isDeadLocal || !gameStarted) return;
    shootMobile();
}

function animate() {
    requestAnimationFrame(animate);

    if (!gameStarted) return;

    const delta = clock.getDelta();

    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw + headYaw;
    camera.rotation.x = pitch;

    let targetFOV = isAiming ? aimedFOV : normalFOV;
    camera.fov += (targetFOV - camera.fov) * 15.0 * delta;
    camera.updateProjectionMatrix();

    Object.keys(otherPlayers).forEach(id => {
        const p = otherPlayers[id];
        if (p.isDead) {
            p.mesh.rotation.order = 'YXZ';
            p.mesh.rotation.x = THREE.MathUtils.lerp(p.mesh.rotation.x, -Math.PI / 2, delta * 8);
            p.mesh.rotation.z = THREE.MathUtils.lerp(p.mesh.rotation.z, -0.5, delta * 8);
            p.mesh.position.y = THREE.MathUtils.lerp(p.mesh.position.y, 0.2, delta * 8);

            p.mesh.traverse(child => {
                if (child.isMesh && child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => {
                            m.opacity = Math.max(0, m.opacity - delta * 0.35);
                        });
                    } else {
                        child.material.opacity = Math.max(0, child.material.opacity - delta * 0.35);
                    }
                }
            });
            if (p.nameTag && p.nameTag.material) {
                p.nameTag.material.opacity = Math.max(0, p.nameTag.material.opacity - delta * 0.35);
            }
        }
    });

    for (let i = bloodParticles.length - 1; i >= 0; i--) {
        const part = bloodParticles[i];
        part.mesh.position.addScaledVector(part.velocity, delta);
        part.velocity.y -= 9.8 * delta;
        part.life -= delta;
        if (part.life <= 0) {
            scene.remove(part.mesh);
            bloodParticles.splice(i, 1);
        }
    }

    if ((isLocked || isMobile) && !isDeadLocal) {
        targetPlayerHeight = isCrouching ? 1.0 : 1.62;
        playerHeight += (targetPlayerHeight - playerHeight) * 15.0 * delta;

        let moveSpeed = isCrouching ? 6.0 : 12.0;

        let inputX = (moveRight ? 1 : 0) - (moveLeft ? 1 : 0);
        let inputZ = (moveForward ? 1 : 0) - (moveBackward ? 1 : 0);

        if (isMobile && mobileJoystick.active) {
            inputX += mobileJoystick.x;
            inputZ += -mobileJoystick.y;
        }

        const isMoving = (inputX !== 0 || inputZ !== 0);

        const moveVector = new THREE.Vector3();

        if (isDashing) {
            dashTimer -= delta;
            moveSpeed = dashSpeed;
            moveVector.copy(dashDirection);

            if (Math.random() < 0.4) {
                spawnGhostShade(camera.position.x, camera.position.y - playerHeight, camera.position.z, yaw + headYaw);
            }

            if (dashTimer <= 0) {
                isDashing = false;
            }
        } else if (isMoving) {
            const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw + headYaw);
            const side = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw + headYaw);

            moveVector.addScaledVector(forward, inputZ);
            moveVector.addScaledVector(side, inputX);
            moveVector.normalize();

            playerWalkTimer += delta * 12;
            if (localPlayerParts) {
                const armSwing = Math.sin(playerWalkTimer) * 0.2;
                localPlayerParts.leftArmGroup.rotation.x = -0.2 + armSwing;
            }
        } else {
            playerWalkTimer = 0;
            if (localPlayerParts) {
                localPlayerParts.leftArmGroup.rotation.x += (-0.2 - localPlayerParts.leftArmGroup.rotation.x) * 0.1;
            }
        }

        camera.position.addScaledVector(moveVector, moveSpeed * delta);
        camera.position.x = Math.max(-248, Math.min(248, camera.position.x));
        camera.position.z = Math.max(-248, Math.min(248, camera.position.z));

        velocity.y -= 32.0 * delta; 
        camera.position.y += velocity.y * delta;

        if (camera.position.y <= playerHeight) {
            velocity.y = 0;
            canJump = true;

            if (isMoving && !isCrouching && !isDashing) {
                headBobTimer += delta * bobFrequency;
                const bobOffset = Math.sin(headBobTimer) * bobAmplitude;
                camera.position.y = playerHeight + bobOffset;
                
                const targetGunX = isAiming ? 0 : 0.25 + Math.cos(headBobTimer) * 0.015;
                const targetGunY = isAiming ? -0.2 : -0.25 + Math.sin(headBobTimer * 2) * 0.015;
                const targetGunZ = isAiming ? -0.4 : -0.5;

                gun.position.x += (targetGunX - gun.position.x) * 0.2;
                gun.position.y += (targetGunY - gun.position.y) * 0.2;
                gun.position.z += (targetGunZ - gun.position.z) * 0.2;
            } else {
                headBobTimer = 0;
                camera.position.y = playerHeight;
                
                const targetGunX = isAiming ? 0 : 0.25;
                const targetGunY = isAiming ? -0.2 : -0.25;
                const targetGunZ = isAiming ? -0.4 : -0.5;

                gun.position.x += (targetGunX - gun.position.x) * 0.2;
                gun.position.y += (targetGunY - gun.position.y) * 0.2;
                gun.position.z += (targetGunZ - gun.position.z) * 0.2;
            }
        }

        socket.emit('playerMovement', {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z,
            yaw: yaw + headYaw,
            pitch: pitch,
            isMoving: isMoving,
            isCrouching: isCrouching,
            isDashing: isDashing
        });

        if (isShooting) {
            recoilTimer -= delta;
            gun.position.z += 0.05;
            if (recoilTimer <= 0) {
                isShooting = false;
            }
        }
    }

    renderer.render(scene, camera);
}

function onWindowResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}